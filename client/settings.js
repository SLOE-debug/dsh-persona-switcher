import {styles,icon} from './shared.js';
export function createSettings(React,api,changes,Updates) {
  const {createElement:h,useState,useEffect,useRef}=React;
  return function Settings(){
    const [items,setItems]=useState([]),[draft,setDraft]=useState(null),[saved,setSaved]=useState(null);
    const [busy,setBusy]=useState(true),[message,setMessage]=useState(''),[confirm,setConfirm]=useState(false);
    const alive=useRef(true),sequence=useRef(0);
    const dirty=!!draft&&(draft.name!==saved?.name||draft.text!==saved?.text);
    async function list(){const value=await api('list');if(alive.current)setItems(value.personas);return value.personas;}
    async function open(name,force=false){
      if(dirty&&!force){setMessage('有未保存的修改，请先保存或放弃修改。');return;}
      const current=++sequence.current;setBusy(true);setMessage('');setConfirm(false);
      try{const value=await api('read',{name});if(alive.current&&current===sequence.current){setDraft(value);setSaved(value);}}
      catch(error){if(alive.current)setMessage(error.message);}finally{if(alive.current&&current===sequence.current)setBusy(false);}
    }
    useEffect(()=>{
      alive.current=true;
      list().then(values=>{if(alive.current){if(values.length)open(values[0].name,true);else setBusy(false);}}).catch(error=>{if(alive.current){setBusy(false);setMessage(error.message);}});
      return()=>{alive.current=false;sequence.current++;};
    },[]);
    function create(){
      if(dirty){setMessage('有未保存的修改，请先保存或放弃修改。');return;}
      sequence.current++;setSaved(null);setDraft({name:'',text:''});setConfirm(false);setMessage('');
    }
    async function save(){
      setBusy(true);setMessage('');
      try{
        const value=await api('save',{original:saved?.name,name:draft.name,text:draft.text,expectedVersion:saved?.version});
        if(!alive.current)return;setDraft(value);setSaved(value);await list();changes.emit();setMessage('已保存，下一次模型请求使用最新正文。');
      }catch(error){if(alive.current)setMessage(error.message);}finally{if(alive.current)setBusy(false);}
    }
    async function remove(){
      setBusy(true);setMessage('');
      try{
        await api('delete',{name:saved.name,expectedVersion:saved.version});
        if(!alive.current)return;setSaved(null);setDraft(null);setConfirm(false);changes.emit();
        const values=await list();if(values.length)await open(values[0].name,true);else setMessage('人格已删除，可以创建新的人格。');
      }catch(error){if(alive.current)setMessage(error.message);}finally{if(alive.current)setBusy(false);}
    }
    return h('section',{className:'dsh-persona tw:flex tw:h-full tw:min-h-96 tw:min-w-0 tw:flex-col tw:gap-5 tw:pr-1'},
      h('header',{className:'tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3'},
        h('div',{className:'tw:flex tw:items-start tw:gap-3'},
          h('div',{className:'tw:flex tw:h-10 tw:w-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-2xl tw:bg-violet-500/10 tw:text-violet-500'},icon(h,'spark',21)),
          h('div',null,h('h2',{className:'tw:m-0 tw:text-base tw:font-semibold'},'人格管理'),
            h('p',{className:styles.muted+' tw:mt-1 tw:mb-0'},'用 Markdown 定义语气与风格，在对话中随时切换。'))),h(Updates)),
      h('div',{className:'tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-1 tw:gap-4 tw:@min-[500px]:grid-cols-[155px_minmax(0,1fr)]'},
        h('aside',{className:'tw:flex tw:min-h-0 tw:flex-col tw:gap-2'},
          h('div',{className:'tw:flex tw:items-center tw:justify-between tw:px-1 tw:pb-1'},h('span',{className:styles.muted},`人格库 · ${items.length}`),
            h('button',{type:'button',className:styles.button+' tw:px-2 tw:py-1.5',onClick:create,disabled:busy,'aria-label':'新增人格'},icon(h,'plus',13),'新增')),
          h('div',{className:'tw:flex tw:max-h-80 tw:flex-col tw:gap-1 tw:overflow-y-auto'},
            ...items.map(item=>h('button',{type:'button',key:item.name,disabled:busy,onClick:()=>open(item.name),
              className:'tw:flex tw:w-full tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:px-3 tw:py-3 tw:text-left tw:text-xs tw:transition-colors '+
                (saved?.name===item.name?'tw:border-violet-500/25 tw:bg-violet-500/10 tw:text-violet-500':'tw:border-transparent tw:hover:bg-[var(--persona-hover)]'),
              'aria-current':saved?.name===item.name?'true':undefined},icon(h,'file',15),h('span',{className:'tw:min-w-0 tw:truncate'},item.name))),
            !items.length&&h('p',{className:styles.muted+' tw:px-2'},'还没有人格，点击“新增”开始。'))),
        h('div',{className:'tw:flex tw:min-h-80 tw:min-w-0 tw:flex-col tw:gap-3 tw:rounded-2xl tw:border tw:border-[var(--persona-border)] tw:bg-[var(--persona-panel)] tw:p-4'},
          draft?h(React.Fragment,null,
            h('div',{className:'tw:flex tw:items-center tw:justify-between tw:gap-2'},h('span',{className:'tw:text-xs tw:font-medium'},saved?'编辑人格':'创建人格'),
              h('span',{className:styles.muted},dirty?'未保存':'.md · 已保存')),
            h('label',{className:'tw:flex tw:flex-col tw:gap-1.5 tw:text-xs tw:font-medium'},'名称',
              h('input',{className:styles.field,value:draft.name,maxLength:80,disabled:busy,placeholder:'例如：可爱、严谨、简洁',
                onChange:event=>{setDraft({...draft,name:event.target.value});setConfirm(false);}})),
            h('label',{className:'tw:flex tw:min-h-48 tw:flex-1 tw:flex-col tw:gap-1.5 tw:text-xs tw:font-medium'},'人格正文',
              h('textarea',{className:styles.field+' tw:min-h-52 tw:flex-1 tw:resize-y tw:font-mono tw:text-xs tw:leading-6',value:draft.text,disabled:busy,
                spellCheck:false,placeholder:'描述希望使用的语气、表达习惯和回复风格…',
                onChange:event=>{setDraft({...draft,text:event.target.value});setConfirm(false);}})),
            h('div',{className:'tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2'},
              h('span',{className:styles.muted},`${new TextEncoder().encode(draft.text).length.toLocaleString()} / 65,536 字节`),
              h('div',{className:'tw:flex tw:items-center tw:gap-2'},
                dirty&&h('button',{type:'button',className:styles.button,disabled:busy,onClick:()=>{setDraft(saved);setConfirm(false);setMessage('');}},'放弃修改'),
                h('button',{type:'button',className:styles.primary,disabled:busy||!dirty||!draft.name.trim()||!draft.text.trim(),onClick:save},busy?'处理中…':'保存人格'))),
            saved&&h('div',{className:'tw:border-t tw:border-[var(--persona-border)] tw:pt-3'},confirm?
              h('div',{className:'tw:flex tw:flex-wrap tw:items-center tw:gap-2'},h('span',{className:styles.muted},`删除“${saved.name}”？使用它的对话将关闭人格。`),
                h('button',{type:'button',className:styles.button,disabled:busy,onClick:()=>setConfirm(false)},'取消'),
                h('button',{type:'button',className:styles.button+' tw:text-red-500',disabled:busy,onClick:remove},'确认删除')):
              h('button',{type:'button',className:'tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded tw:text-xs tw:text-[var(--persona-muted)] tw:hover:text-red-500',disabled:busy,onClick:()=>setConfirm(true)},icon(h,'trash',13),'删除人格'))):
            h('div',{className:'tw:flex tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:py-12 tw:text-center'},icon(h,'file',28),h('span',{className:styles.muted},busy?'正在载入人格…':'选择一个人格，或创建你自己的风格。')))),
      message&&h('p',{role:'status',className:styles.muted+' tw:m-0 tw:break-words'},message),
      h('p',{className:styles.muted+' tw:m-0'},'保存后立即生效 · 开关仅属于当前对话 · 新对话默认关闭'));
  };
}
