// Type declarations for cli-table3
// cli-table3 provides built-in types but they're incomplete for our use

declare module 'cli-table3' {
  interface TableOptions {
    head?: string[];
    colWidths?: number[];
    style?: {
      head?: string[];
      border?: string[];
      'padding-left'?: number;
      'padding-right'?: number;
    };
    chars?: Record<string, string>;
    wordWrap?: boolean;
    wrapOnWordBoundary?: boolean;
  }

  class Table {
    constructor(options?: TableOptions);
    push(...items: (string | object)[][]): void;
    toString(): string;
    length: number;
  }

  export = Table;
}
