import {createHash} from 'node:crypto';

export const fingerprint = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

export async function resolveTarget(candidate) {
  if (!candidate || typeof candidate.url !== 'string' || typeof candidate.exportName !== 'string' ||
      typeof candidate.methodName !== 'string' || typeof candidate.methodSha256 !== 'string') {
    throw new Error('定位信息不完整，请重新识别入口。');
  }
  const namespace = await import(candidate.url);
  const constructor = namespace[candidate.exportName];
  const prototype = typeof constructor === 'function' ? constructor.prototype : undefined;
  const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, candidate.methodName);
  if (typeof descriptor?.value !== 'function' || descriptor.writable !== true || descriptor.configurable !== true) {
    throw new Error('候选入口无法替换或不是实例方法。');
  }
  if (fingerprint(Function.prototype.toString.call(descriptor.value)) !== candidate.methodSha256) {
    throw new Error('运行中的函数与发现结果不一致，请重启 DSH 后重新识别。');
  }
  return {prototype, descriptor};
}
