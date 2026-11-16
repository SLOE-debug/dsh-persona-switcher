export class LlmRuntime {
  forAdapter(options, adapter) {
    // signature revision one
    const messages = options.messages.map(message => {
      if (message.role !== 'assistant') return message;
      const source = message.source;
      if (source.replayState === undefined) return message;
      if (this.adapters.get(source.provider)?.adapter === adapter) return message;
      return Object.freeze({...message, source: {
        kind: 'model', provider: source.provider, model: source.model
      }});
    });
    if (messages.every((message, index) => message === options.messages[index])) return options;
    const filtered = {...options, messages};
    return Object.isFrozen(options) ? Object.freeze(filtered) : filtered;
  }
  async *stream(options) {
    const adapter = {};
    const dispatch = () => ({async *[Symbol.asyncIterator]() {}});
    yield* dispatch(this.forAdapter(options, adapter))[Symbol.asyncIterator]();
  }
}
