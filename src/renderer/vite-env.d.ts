interface ImportMeta {
  readonly env: Record<string, string | undefined>
}

declare module '*.ps1?raw' {
  const source: string
  export default source
}
