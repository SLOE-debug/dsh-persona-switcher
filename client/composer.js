import {styles,icon} from './shared.js';
import {createPersonaPicker} from './persona-picker.js';
export function createComposer(React,api,changes) {
  const {createElement:h,useState,useEffect,useRef}=React;
  const Picker=createPersonaPicker(React);
  return function Composer({sessionId,useProjection}) {
    const preset=useProjection('agentPreset');
    const [snapshot,setSnapshot]=useState(null),[personas,setPersonas]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
    const epoch=useRef(0),active=useRef(null);
    useEffect(()=>{
      const current=++epoch.current,abort=new AbortController();active.current=abort;
      setSnapshot(null);setPersonas([]);setBusy(false);setMessage('');
      async function refresh(){
        try{
          const [state,list]=await Promise.all([api('state',{sessionId},abort.signal),api('list',{},abort.signal)]);
          if(epoch.current===current){setSnapshot(state);setPersonas(list.personas);}
        }catch(error){if(!abort.signal.aborted&&epoch.current===current)setMessage(error.message);}
      }
      refresh();const off=changes.subscribe(refresh);
      return()=>{epoch.current++;abort.abort();off();};
    },[sessionId]);
    const ready=snapshot?.sessionId===sessionId,enabled=ready&&snapshot.enabled,standard=preset==='standard';
    async function change(next){
      const current=epoch.current;setBusy(true);setMessage('');
      try{
        const state=await api('set',{sessionId,enabled:!!enabled,persona:snapshot.persona,...next},active.current.signal);
        if(current===epoch.current)setSnapshot(state);
      }catch(error){if(current===epoch.current&&!active.current.signal.aborted)setMessage(error.message);}
      finally{if(current===epoch.current)setBusy(false);}
    }
    return h('div',{className:'dsh-persona dsh-persona-composer', 'data-persona-session':sessionId},
      h('div',{className:'tw:flex tw:min-h-7 tw:items-center tw:gap-2'},
          h('span',{className:'tw:flex tw:shrink-0 tw:items-center tw:text-[var(--persona-muted)]',title:'当前对话的人格'},icon(h,'spark',13)),
          h(Picker,{items:personas,value:ready?snapshot.persona:null,disabled:busy||!ready||!personas.length,sessionId,onChange:persona=>change({persona})}),
          h('button',{type:'button',role:'switch','aria-label':'为当前对话启用人格','aria-checked':!!enabled,disabled:busy||!ready||!standard||!snapshot?.persona,
            title:standard?'仅当前对话生效，新对话默认关闭':'仅标准预设生效',
            onClick:()=>change({enabled:!enabled}),className:'tw:inline-flex tw:h-7 tw:shrink-0 tw:items-center tw:gap-1.5 tw:whitespace-nowrap tw:rounded-lg tw:px-1 tw:text-xs tw:disabled:opacity-40 tw:focus-visible:outline-2 tw:focus-visible:outline-violet-500'},
            h('span',{className:'tw:relative tw:inline-block tw:h-4 tw:w-7 tw:rounded-full tw:transition-colors '+(enabled?'tw:bg-violet-600':'tw:bg-[var(--persona-track)]')},
              h('span',{className:'tw:absolute tw:left-0 tw:top-0.5 tw:h-3 tw:w-3 tw:rounded-full tw:bg-white tw:shadow-sm tw:transition-transform '+(enabled?'tw:translate-x-3.5':'tw:translate-x-0.5')})),enabled?'开启':'关闭')),
      message&&h('p',{role:'status',className:styles.muted+' tw:mt-1 tw:mb-0 tw:px-1'},message));
  };
}
