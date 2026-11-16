export const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise hooks and RPC completions without opening a browser or creating chats.
export function renderer({element}={}) {
  const slots = [], effects = [];
  let cursor = 0, component, props, scheduled = false, tree;
  function schedule() {
    if (scheduled) return; scheduled = true;
    queueMicrotask(() => { scheduled = false; render(props); });
  }
  function render(next) {
    props = next; cursor = 0; tree = component(props);
    if(element)attachRefs(tree);
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  function attachRefs(node){
    if(!node||typeof node!=='object')return;
    if(node.props?.ref&&!node.props.ref.current)node.props.ref.current=element(node);
    for(const child of node.children??[])attachRefs(child);
  }
  const React = {
    Fragment:Symbol('fragment'),
    createElement: (type, attributes, ...children) => ({type, props: attributes ?? {}, children}),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {value: initial};
      return [slots[index].value, value => {
        if (Object.is(slots[index].value, value)) return;
        slots[index].value = value; schedule();
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= {current: initial}; },
    useId(){const index=cursor++;return (slots[index]??={id:'test-id-'+index}).id;},
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (previous && deps.every((value, key) => value === previous.deps[key])) return;
      previous?.cleanup?.();
      const record = slots[index] = {deps};
      effects.push(() => { record.cleanup = callback(); });
    },
  };
  function find(predicate,node=tree) {
    if(!node||typeof node!=='object')return;
    if(predicate(node))return node;
    for(const child of node.children??[]){const found=find(predicate,child);if(found)return found;}
  }
  return {React, find, mount: (fn, value) => { component = fn; return render(value); }, render,
    tree: () => tree, close: () => { for (const item of slots) item?.cleanup?.(); }};
}
