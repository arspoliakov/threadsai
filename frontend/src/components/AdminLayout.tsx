import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { getCurrentUser } from '../api/client';

export function AdminEntry() {
 const [allowed,setAllowed]=useState(false);
 useEffect(()=>{let active=true; void getCurrentUser().then(u=>{if(active)setAllowed(Boolean(u.is_operator));}).catch(()=>{});return()=>{active=false;};},[]);
 return allowed ? <Link to='/app/admin' className='rounded-full bg-[var(--workspace-accent)] px-3 py-2 text-xs font-semibold text-[var(--workspace-accent-ink)] sm:px-4 sm:text-sm'>Админка</Link> : null;
}

export default function AdminLayout() {
 const [access,setAccess]=useState<'loading'|'allowed'|'denied'>('loading');
 useEffect(()=>{let active=true;void getCurrentUser().then(u=>{if(active)setAccess(u.is_operator?'allowed':'denied');}).catch(()=>{if(active)setAccess('denied');});return()=>{active=false;};},[]);
 if(access==='loading')return <p role='status'>Проверяем доступ администратора…</p>;
 if(access==='denied')return <section className='workspace-page'><h1 className='text-2xl font-semibold'>Раздел доступен только владельцу</h1><Link to='/app' className='mt-5 inline-block underline'>Вернуться в кабинет</Link></section>;
 return <div className='space-y-6'><div className='rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-4'><p className='mb-3 text-sm font-semibold'>Управление ThreadsGo · аккаунт владельца</p><nav aria-label='Разделы администратора' className='flex flex-wrap gap-2'>{[['/app/admin','Дашборд'],['/app/admin/users','Пользователи и подписки'],['/app/admin/proxies','Прокси и хранилище'],['/app/admin/retention','Рассылки']].map(([to,label])=><NavLink key={to} to={to} end={to==='/app/admin'} className={({isActive})=>`rounded-full px-4 py-2 text-sm ${isActive?'bg-[var(--workspace-accent)] text-[var(--workspace-accent-ink)]':'border border-[var(--workspace-border)]'}`}>{label}</NavLink>)}</nav></div><Outlet/></div>;
}
