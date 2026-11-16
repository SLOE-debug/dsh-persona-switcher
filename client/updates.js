import {styles,icon} from './shared.js';
export function createUpdates(React,api) {
  const {createElement:h,useState,useRef,useEffect}=React;
  return function Updates(){
    const [busy,setBusy]=useState(false),[target,setTarget]=useState(null),[message,setMessage]=useState('');
    const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    async function run(update){
      setBusy(true);setMessage('');
      try{
        const value=await api(update?'update':'check-update');
        if(!alive.current)return;
        setTarget(update?null:value);
        setMessage(update?(value.updated?'更新已激活。':'已是最新提交。'):value.available?'发现新版本。':value.development?'本地开发版，GitHub 暂无新提交。':'已是最新提交。');
      }catch(error){if(alive.current)setMessage(error.message);}
      finally{if(alive.current)setBusy(false);}
    }
    return h('div',{className:'tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2'},
      h('button',{type:'button',className:styles.button,disabled:busy,onClick:()=>run(false)},icon(h,'refresh',13),busy?'处理中…':'检查更新'),
      target?.available&&target.hotReload&&h('button',{type:'button',className:styles.primary,disabled:busy,onClick:()=>run(true)},'热更新'),
      message&&h('span',{role:'status',className:styles.muted+' tw:max-w-72 tw:break-words'},message));
  };
}
