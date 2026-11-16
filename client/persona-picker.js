import {icon} from './shared.js';

export function createPersonaPicker(React) {
  const {createElement:h,useState,useRef,useEffect,useId}=React;
  return function PersonaPicker({items,value,disabled,sessionId,onChange}) {
    const [open,setOpen]=useState(false),[active,setActive]=useState(value);
    const trigger=useRef(null),panel=useRef(null),search=useRef({text:'',time:0});
    const id=useId();
    const index=items.findIndex(item=>item.name===active);
    function position(){
      const anchor=trigger.current.getBoundingClientRect();
      const width=Math.min(224,window.innerWidth-16),above=anchor.top-14,below=window.innerHeight-anchor.bottom-14;
      const upwards=above>=Math.min(280,items.length*36+40)||above>=below;
      Object.assign(panel.current.style,{width:width+'px',left:Math.max(8,Math.min(anchor.left,window.innerWidth-width-8))+'px',
        top:upwards?'auto':anchor.bottom+6+'px',bottom:upwards?window.innerHeight-anchor.top+6+'px':'auto',
        maxHeight:Math.max(40,Math.min(320,upwards?above:below))+'px'});
    }
    function close(){panel.current?.hidePopover();setOpen(false);search.current={text:'',time:0};}
    function show(name=value){
      if(disabled||!items.length)return;
      setActive(items.some(item=>item.name===name)?name:items[0].name);
      position();panel.current.showPopover();setOpen(true);
    }
    function choose(name){close();trigger.current.focus();if(name!==value)onChange(name);}
    useEffect(()=>{
      const element=panel.current;
      const toggle=event=>setOpen(event.newState==='open');
      element.addEventListener('toggle',toggle);
      return()=>{element.removeEventListener('toggle',toggle);element.hidePopover();};
    },[]);
    useEffect(()=>{close();},[sessionId,disabled]);
    useEffect(()=>{
      if(!open)return;
      position();panel.current.querySelectorAll('[role="option"]')[index]?.scrollIntoView({block:'nearest'});
      window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
      return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};
    },[open,active,items]);
    function keyDown(event){
      if(disabled||event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key==='Tab'){close();return;}
      if(event.key==='Escape'){if(open){event.preventDefault();event.stopPropagation();close();}return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();
        if(!open){show(event.key==='End'?items.at(-1)?.name:event.key==='Home'?items[0]?.name:value);return;}
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:
          (index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
        setActive(items[next]?.name);return;
      }
      if(event.key==='Enter'||event.key===' '){event.preventDefault();if(open&&active)choose(active);else show();return;}
      if(event.key.length===1){
        event.preventDefault();const now=Date.now();
        const text=(now-search.current.time<700?search.current.text:'')+event.key.toLocaleLowerCase();
        search.current={text,time:now};const match=items.find(item=>item.name.toLocaleLowerCase().startsWith(text));
        if(!open)show(match?.name);else if(match)setActive(match.name);
      }
    }
    return h('div',{className:'tw:min-w-0'},
      h('button',{ref:trigger,type:'button',role:'combobox','aria-label':'当前对话的人格','aria-haspopup':'listbox','aria-expanded':open,
        'aria-controls':id,'aria-activedescendant':open&&index>=0?`${id}-${index}`:undefined,disabled,
        onClick:()=>open?close():show(),onKeyDown:keyDown,
        className:'tw:flex tw:h-7 tw:w-36 tw:max-w-full tw:items-center tw:justify-between tw:gap-2 tw:rounded-lg tw:border tw:border-transparent tw:bg-transparent tw:px-2 tw:text-xs tw:transition-colors tw:hover:bg-[var(--persona-hover)] tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-violet-500/25 tw:disabled:opacity-40 '+(open?'tw:bg-[var(--persona-hover)]':'')},
        h('span',{className:'tw:min-w-0 tw:truncate'},value||'请先创建人格'),
        h('span',{className:'tw:shrink-0 tw:text-[var(--persona-muted)] tw:transition-transform '+(open?'tw:rotate-180':'')},icon(h,'chevron',12))),
      h('div',{ref:panel,popover:'auto',id:id+'-panel',className:'persona-picker-panel',onKeyDown:keyDown},
        h('div',{className:'tw:flex tw:items-center tw:justify-between tw:px-2 tw:pt-1 tw:pb-2 tw:text-[10px] tw:text-[var(--persona-muted)]'},
          h('span',null,'选择人格'),h('span',null,items.length)),
        h('div',{id,role:'listbox','aria-label':'人格列表',className:'tw:flex tw:flex-col tw:gap-0.5'},
          ...items.map((item,itemIndex)=>h('button',{key:item.name,id:`${id}-${itemIndex}`,type:'button',role:'option',tabIndex:-1,
            'aria-selected':item.name===value,onPointerMove:()=>setActive(item.name),onPointerDown:event=>event.preventDefault(),onClick:()=>choose(item.name),
            className:'tw:flex tw:min-h-8 tw:w-full tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-transparent tw:px-2 tw:py-1.5 tw:text-left tw:text-xs tw:transition-colors '+
              (item.name===active?'tw:bg-violet-500/10':'tw:bg-transparent')+' '+(item.name===value?'tw:font-medium tw:text-violet-500':'tw:text-[var(--persona-ink)]')},
            h('span',{className:'tw:shrink-0 tw:opacity-65'},icon(h,'file',14)),h('span',{className:'tw:min-w-0 tw:flex-1 tw:truncate',title:item.name},item.name),
            item.name===value&&h('span',{className:'tw:shrink-0'},icon(h,'check',14)))))));
  };
}
