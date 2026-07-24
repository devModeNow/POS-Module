declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  readonly NG_APP_API_BASE_URL?: string;
  readonly NG_APP_ENV?: string;
  readonly [key: string]: string | undefined;
}
