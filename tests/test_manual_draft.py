import unittest
from tests import test_api_smoke as fixtures
class ManualDraftTest(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixtures.ApiSmokeTest.asyncSetUp
 asyncTearDown=fixtures.ApiSmokeTest.asyncTearDown
 async def test_own_text_is_unscheduled_draft(self):
  r=await self.client.post('/api/v1/tasks/manual',json={'project_id':1,'content_text':'Мой собственный пост'})
  self.assertEqual(r.status_code,201,r.text);data=r.json();self.assertEqual(data['status'],'draft');self.assertIsNone(data['scheduled_at']);self.assertIsNone(data['account_id']);self.assertEqual(data['generation_metadata']['source'],'manual')
 async def test_other_project_not_accessible(self):
  r=await self.client.post('/api/v1/tasks/manual',json={'project_id':2,'content_text':'Чужой проект'})
  self.assertEqual(r.status_code,404)
 async def test_blank_or_long_post_rejected(self):
  for text in ['   ','x'*501]:
   r=await self.client.post('/api/v1/tasks/manual',json={'project_id':1,'content_text':text});self.assertEqual(r.status_code,422)
 async def test_missing_connection_does_not_start_ideas(self):
  r=await self.client.post('/api/v1/projects/1/trigger-scraping')
  self.assertEqual(r.status_code,409,r.text)
  dashboard=(await self.client.get('/api/v1/projects/1/dashboard')).json()
  self.assertFalse(any(a['ready_for_ideas'] for a in dashboard['account_states']))
