export function createApi(connection) {
  return async(method,payload={},signal)=>{
    const result=await connection.rpc.call('/api',`dsh-persona-${method}`,payload,signal);
    if(!result.ok) throw new Error(result.error?.message||'操作失败，请重试。');
    return result.value;
  };
}
export function createChanges() {
  const listeners=new Set();
  return {subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},emit(){for(const fn of listeners)fn();}};
}
export const styles={
  button:'tw:inline-flex tw:items-center tw:justify-center tw:gap-1.5 tw:rounded-lg tw:border tw:border-[var(--persona-border)] tw:bg-[var(--persona-panel)] tw:px-3 tw:py-2 tw:text-xs tw:font-medium tw:transition-colors tw:hover:bg-[var(--persona-hover)] tw:disabled:opacity-40 tw:disabled:cursor-not-allowed tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-violet-500',
  primary:'tw:inline-flex tw:items-center tw:justify-center tw:gap-1.5 tw:rounded-lg tw:border tw:border-violet-600 tw:bg-violet-600 tw:px-3 tw:py-2 tw:text-xs tw:font-medium tw:text-white tw:hover:bg-violet-700 tw:disabled:opacity-40 tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-violet-500',
  field:'tw:w-full tw:rounded-xl tw:border tw:border-[var(--persona-border)] tw:bg-[var(--persona-panel)] tw:px-3 tw:py-2.5 tw:text-sm tw:outline-none tw:transition-shadow tw:focus:border-violet-400 tw:focus:ring-2 tw:focus:ring-violet-500/15',
  muted:'tw:text-xs tw:leading-5 tw:text-[var(--persona-muted)]',
};
export function icon(h,name,size=16) {
  const paths={spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
    check:'m5 12 4 4L19 6',plus:'M12 5v14M5 12h14',chevron:'m6 9 6 6 6-6',file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8L14 2ZM14 2v6h6M8 13h8M8 17h6',
    refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'};
  return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]}));
}
