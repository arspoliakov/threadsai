import unittest
from unittest.mock import patch
import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from sqlalchemy.pool import StaticPool
from app.api.auth import create_access_token
from app.api.deps import get_db
from app.api.routes.admin import router
from app.core.config import settings
from app.db.base import Base
from app.db.models import User

class AdminAccessTest(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.engine=create_async_engine('sqlite+aiosqlite:///:memory:',poolclass=StaticPool)
  self.sessions=async_sessionmaker(self.engine,expire_on_commit=False)
  async with self.engine.begin() as c: await c.run_sync(Base.metadata.create_all)
  async with self.sessions() as db:
   db.add_all([User(id=1,telegram_id=111,first_name='Owner'),User(id=2,telegram_id=222,first_name='Client')]);await db.commit()
  self.original=(settings.admin_tg_id,settings.web_admin_token,settings.jwt_secret_key)
  settings.admin_tg_id=111;settings.web_admin_token='legacy-static-token';settings.jwt_secret_key='test-only-signing-secret-at-least-32-characters'
  self.factory=patch('app.api.deps.AsyncSessionLocal',self.sessions);self.factory.start()
  app=FastAPI();app.include_router(router)
  async def db_override():
   async with self.sessions() as db:yield db
  app.dependency_overrides[get_db]=db_override
  self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture')
 async def asyncTearDown(self):
  await self.client.aclose();self.factory.stop();settings.admin_tg_id,settings.web_admin_token,settings.jwt_secret_key=self.original;await self.engine.dispose()
 def header(self,uid,tid):return {'Authorization':'Bearer '+create_access_token({'sub':str(uid),'telegram_id':tid})}
 async def test_owner_overview_and_user_search(self):
  r=await self.client.get('/admin/overview',headers=self.header(1,111));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['counts']['users'],2)
  r=await self.client.get('/admin/users?search=222',headers=self.header(1,111));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['total'],1);self.assertNotIn('tribute_last_event_json',r.text)
 async def test_missing_and_legacy_credentials_rejected(self):
  self.assertEqual((await self.client.get('/admin/overview')).status_code,401)
  self.assertEqual((await self.client.get('/admin/overview',headers={'Authorization':'Bearer legacy-static-token'})).status_code,403)
 async def test_other_user_cannot_open_admin_routes(self):
  for path in ['/admin/overview','/admin/users']:
   self.assertEqual((await self.client.get(path,headers=self.header(2,222))).status_code,403)
 async def test_owner_claim_must_match_database_identity(self):
  self.assertEqual((await self.client.get('/admin/overview',headers=self.header(2,111))).status_code,403)
