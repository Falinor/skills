// The part of highlight.js's API the tool uses.
declare const hljs: {
  getLanguage(name: string): object | undefined;
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
};
export default hljs;
