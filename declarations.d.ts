/* eslint-disable @typescript-eslint/camelcase */

declare module 'object-deep-contain' {
  export default function(bigObject: unknown, smallerObject: unknown): boolean
}

declare module 'ci-env' {
  export const branch: string | boolean | undefined
  export const pull_request_number: string | boolean | undefined
  export const pull_request_target_branch: string | boolean | undefined
  export const ci: string | boolean | undefined
  export const platform: string | boolean | undefined
}

declare module '@hutson/set-npm-auth-token-for-ci' {
  export default function(): void
}

declare module 'npm-login-noninteractive' {
  // docs: https://github.com/icdevin/npm-login-noninteractive
  export default function(
    npmUsername: string,
    npmPassword: string,
    npmEmail: string,
    npmRegistryAddress?: string, // example: https://npm.example.com or http://localhost:4873
    scope?: string,
    configPath?: string,
  ): void
}

declare module 'object-delete-key' {
  export default function(
    originalInput: unknown,
    originalOpts: {
      key?: string
      value?: string
      cleanup?: boolean
      only?: 'any' | 'object-type' | 'array-type'
    },
  ): object
}

declare module 'node-git-server' {
  type ConstatuctorOptions = {
    authenticate: (
      options: { type: string; repo: 1; user: (callback: (username: string, password: string) => void) => void },
      next: () => void,
    ) => void
  }
  export default class NodeGitServer {
    constructor(reposPath: string, options: ConstatuctorOptions)
    close: () => Promise<void>
    create: (repoName: string, cb: () => void) => void
    listen: (port: number, cb: (err: unknown) => void) => void
    server: Server
  }
}
