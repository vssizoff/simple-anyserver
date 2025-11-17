interface ParsedSegment {
    type:
        | 'static'
        | 'named'
        | 'named-regex'
        | 'named-suffix'
        | 'named-regex-suffix'
        | 'catch-all'
        | 'literal-colon'
        | 'wildcard';
    name?: string;
    value?: string;
    regex?: string;
    suffix?: string;
}

interface MatchResult {
    params: Record<string, string>;
    handlers: Function[];
}

interface RouteTrieOptions {
    ignoreCase?: boolean;
    fixedPath?: boolean;
    trailingSlash?: boolean;
}

class TrieNode {
    staticChildren: Map<string, TrieNode> = new Map();
    paramChildren: {
        type: 'named' | 'named-regex' | 'named-suffix' | 'named-regex-suffix';
        name: string;
        regex?: RegExp;
        suffix?: string;
        node: TrieNode;
    }[] = [];
    catchAllChild: { name: string; node: TrieNode } | null = null;
    wildcardChild: TrieNode | null = null;
    handlers: Function[] = [];

    addHandler(handler: Function): void {
        this.handlers.push(handler);
    }
}

class RouteTrie {
    private root: TrieNode = new TrieNode();
    private options: Required<RouteTrieOptions>;
    private routes: Map<string, Function[]> = new Map();

    constructor(options: RouteTrieOptions = {}) {
        this.options = {
            ignoreCase: options.ignoreCase ?? true,
            fixedPath: options.fixedPath ?? true,
            trailingSlash: options.trailingSlash ?? true,
        };
    }

    addRoute(path: string, handler: Function): void {
        const normalizedPath = this.normalizeRoutePath(path);
        if (!this.routes.has(normalizedPath)) {
            this.routes.set(normalizedPath, []);
        }
        this.routes.get(normalizedPath)!.push(handler);

        const segments = normalizedPath.split('/').filter(segment => segment !== '');
        this._addRoute(this.root, segments, 0, handler);
    }

    private normalizeRoutePath(path: string): string {
        let normalized = path;

        // Always trim leading/trailing slashes for consistent storage
        normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');

        // Apply case normalization if enabled
        if (this.options.ignoreCase) {
            normalized = normalized.toLowerCase();
        }

        // Apply fixed path normalization if enabled
        if (this.options.fixedPath) {
            normalized = normalized.replace(/\/+/g, '/');
        }

        return normalized;
    }

    match(path: string): MatchResult[] {
        // First try: exact match with original path structure
        const exactMatch = this._matchPath(path, false, false);
        if (exactMatch.length > 0) {
            return exactMatch;
        }

        // Second try: fixed path normalization (only if enabled)
        if (this.options.fixedPath) {
            const fixedMatch = this._matchPath(path, true, false);
            if (fixedMatch.length > 0) {
                return fixedMatch;
            }
        }

        // Third try: trailing slash handling (only if enabled)
        if (this.options.trailingSlash) {
            const trailingMatch = this._matchPath(path, this.options.fixedPath, true);
            if (trailingMatch.length > 0) {
                return trailingMatch;
            }
        }

        return [];
    }

    private _matchPath(path: string, useFixedPath: boolean, useTrailingSlash: boolean): MatchResult[] {
        // Normalize path for matching based on options
        let normalized = path;

        // Handle fixed path normalization
        if (useFixedPath) {
            normalized = normalized.replace(/\/+/g, '/');
        }

        // Handle trailing slash normalization
        if (useTrailingSlash) {
            normalized = normalized.replace(/\/+$/, '');
        }

        // Apply case normalization if enabled
        if (this.options.ignoreCase) {
            normalized = normalized.toLowerCase();
        }

        // Split into segments
        const segments = normalized.split('/');

        // Filtered segments logic
        let filtered: string[] = [];
        let i = 0;
        while (i < segments.length && segments[i] === '') i++;

        let k = segments.length - 1;
        while (k >= i && segments[k] === '') k--;

        const contentEnd = k + 1;
        const trailingEmptiesCount = segments.length - contentEnd;

        for (let m = i; m < contentEnd; m++) {
            if (segments[m] !== '' || !useFixedPath) {
                filtered.push(segments[m]);
            }
        }

        const addTrailing = !useTrailingSlash && trailingEmptiesCount > 0;
        if (addTrailing) {
            const numToAdd = useFixedPath ? 1 : trailingEmptiesCount;
            for (let n = 0; n < numToAdd; n++) {
                filtered.push('');
            }
        }

        return this._match(this.root, filtered, 0, {});
    }

    private _addRoute(node: TrieNode, segments: string[], index: number, handler: Function): void {
        if (index >= segments.length) {
            node.addHandler(handler);
            return;
        }

        const segment = segments[index];
        const parsed = this.parseSegment(segment);

        switch (parsed.type) {
            case 'static':
                const staticValue = parsed.value!;
                if (!node.staticChildren.has(staticValue)) {
                    node.staticChildren.set(staticValue, new TrieNode());
                }
                this._addRoute(node.staticChildren.get(staticValue)!, segments, index + 1, handler);
                break;

            case 'named':
            case 'named-regex':
            case 'named-suffix':
            case 'named-regex-suffix':
                let paramNode: TrieNode | undefined;
                for (const param of node.paramChildren) {
                    if (param.name === parsed.name &&
                        param.type === parsed.type &&
                        param.regex?.toString() === (parsed.regex ? new RegExp(parsed.regex).toString() : undefined) &&
                        param.suffix === parsed.suffix) {
                        paramNode = param.node;
                        break;
                    }
                }

                if (!paramNode) {
                    paramNode = new TrieNode();
                    let regexObj: RegExp | undefined;

                    if (parsed.regex) {
                        try {
                            regexObj = new RegExp(`^${parsed.regex}$`, this.options.ignoreCase ? 'i' : '');
                        } catch (e) {
                            throw new Error(`Invalid regex in route: ${parsed.regex}`);
                        }
                    }

                    node.paramChildren.push({
                        type: parsed.type as any,
                        name: parsed.name!,
                        regex: regexObj,
                        suffix: parsed.suffix,
                        node: paramNode
                    });
                }

                this._addRoute(paramNode, segments, index + 1, handler);
                break;

            case 'catch-all':
                if (!node.catchAllChild) {
                    node.catchAllChild = { name: parsed.name!, node: new TrieNode() };
                }
                this._addRoute(node.catchAllChild.node, segments, index + 1, handler);
                break;

            case 'wildcard':
                if (!node.wildcardChild) {
                    node.wildcardChild = new TrieNode();
                }
                this._addRoute(node.wildcardChild, segments, segments.length, handler);
                break;
        }
    }

    private parseSegment(segment: string): ParsedSegment {
        if (segment.startsWith('::')) {
            return { type: 'static', value: ':' + segment.slice(2) };
        }

        if (segment === '*') {
            return { type: 'wildcard' };
        }

        if (segment.endsWith('*') && segment[0] === ':') {
            return { type: 'catch-all', name: segment.slice(1, -1) };
        }

        const suffixRegex = /:([a-zA-Z0-9_]+)(?:\(([^)]+)\))?\+(.+)/;
        const suffixMatch = segment.match(suffixRegex);
        if (suffixMatch) {
            const [, name, regex, suffix] = suffixMatch;
            return {
                type: regex ? 'named-regex-suffix' : 'named-suffix',
                name,
                regex,
                suffix
            };
        }

        const regexMatch = segment.match(/:([a-zA-Z0-9_]+)\(([^)]+)\)/);
        if (regexMatch) {
            const [, name, regex] = regexMatch;
            return { type: 'named-regex', name, regex };
        }

        if (segment.startsWith(':')) {
            return { type: 'named', name: segment.slice(1) };
        }

        return { type: 'static', value: segment };
    }

    private _match(
        node: TrieNode,
        segments: string[],
        index: number,
        params: Record<string, string>
    ): MatchResult[] {
        const results: MatchResult[] = [];

        if (index >= segments.length) {
            if (node.handlers.length > 0) {
                results.push({
                    params: { ...params },
                    handlers: [...node.handlers]
                });
            }

            if (node.catchAllChild) {
                const newParams = { ...params, [node.catchAllChild.name]: '' };
                if (node.catchAllChild.node.handlers.length > 0) {
                    results.push({
                        params: newParams,
                        handlers: [...node.catchAllChild.node.handlers]
                    });
                }
            }

            return results;
        }

        const currentSegment = segments[index];

        // 1. Check static children
        if (node.staticChildren.has(currentSegment)) {
            const childNode = node.staticChildren.get(currentSegment)!;
            results.push(...this._match(childNode, segments, index + 1, params));
        }

        // 2. Check parameter children
        for (const param of node.paramChildren) {
            let paramValue: string | null = null;
            let segmentToMatch = currentSegment;

            switch (param.type) {
                case 'named':
                    paramValue = currentSegment;
                    break;

                case 'named-regex':
                    if (param.regex && param.regex.test(segmentToMatch)) {
                        paramValue = currentSegment;
                    }
                    break;

                case 'named-suffix':
                    if (param.suffix && segmentToMatch.endsWith(param.suffix)) {
                        paramValue = segmentToMatch.slice(0, -param.suffix.length);
                    }
                    break;

                case 'named-regex-suffix':
                    if (param.suffix && segmentToMatch.endsWith(param.suffix)) {
                        const value = segmentToMatch.slice(0, -param.suffix.length);
                        if (param.regex && param.regex.test(value)) {
                            paramValue = currentSegment.slice(0, -param.suffix.length);
                        }
                    }
                    break;
            }

            if (paramValue !== null) {
                const newParams = { ...params, [param.name]: paramValue };
                results.push(...this._match(param.node, segments, index + 1, newParams));
            }
        }

        // 3. Check catch-all parameter
        if (node.catchAllChild) {
            const remainingPath = segments.slice(index).join('/');
            const newParams = { ...params, [node.catchAllChild.name]: remainingPath };

            if (node.catchAllChild.node.handlers.length > 0) {
                results.push({
                    params: newParams,
                    handlers: [...node.catchAllChild.node.handlers]
                });
            }
        }

        // 4. Check wildcard pattern
        if (node.wildcardChild && index < segments.length) {
            results.push(...this._match(node.wildcardChild, segments, segments.length, params));
        }

        return results;
    }
}

// Create strict router with all options disabled
const strictRouter = new RouteTrie({
    ignoreCase: false,
    fixedPath: false,
    trailingSlash: false
});

// Add routes
strictRouter.addRoute('/api/foo', () => console.log('Handler 1: API Foo'));
strictRouter.addRoute('/foo', () => console.log('Handler 2: Foo'));

// Create lenient router with all options enabled for comparison
const lenientRouter = new RouteTrie({
    ignoreCase: true,
    fixedPath: true,
    trailingSlash: true
});

lenientRouter.addRoute('/api/foo', () => console.log('Handler: API Foo'));
lenientRouter.addRoute('/foo', () => console.log('Handler: Foo'));

console.log('=== STRICT ROUTER TESTS (all options disabled) ===\n');

const strictTests = [
    { path: '/api//foo', shouldMatch: false, route: '/api/foo' },
    { path: '/api/foo/', shouldMatch: false, route: '/api/foo' },
    { path: '/foo/', shouldMatch: false, route: '/foo' },
    { path: '/FOO', shouldMatch: false, route: '/foo' },
    { path: '/api/foo', shouldMatch: true, route: '/api/foo' },  // Should match exact route
    { path: '/foo', shouldMatch: true, route: '/foo' }            // Should match exact route
];

strictTests.forEach(test => {
    const matches = strictRouter.match(test.path);
    const matched = matches.length > 0;

    console.log(`TEST: "${test.path}" matching "${test.route}"`);
    console.log(`RESULT: ${matched ? '✓ MATCHED' : '✗ NO MATCH'} (expected: ${test.shouldMatch ? 'match' : 'no match'})`);

    if (matched) {
        console.log(`PARAMS:`, matches[0].params);
        console.log(`HANDLERS:`, matches[0].handlers.length);
    }
    console.log('');
});

console.log('=== LENIENT ROUTER TESTS (all options enabled) ===\n');

const lenientTests = [
    { path: '/api//foo', shouldMatch: true },
    { path: '/api/foo/', shouldMatch: true },
    { path: '/foo/', shouldMatch: true },
    { path: '/FOO', shouldMatch: true },
    { path: '/api/foo', shouldMatch: true }
];

lenientTests.forEach(test => {
    const matches = lenientRouter.match(test.path);
    const matched = matches.length > 0;

    console.log(`TEST: "${test.path}"`);
    console.log(`RESULT: ${matched ? '✓ MATCHED' : '✗ NO MATCH'} (expected: ${test.shouldMatch ? 'match' : 'no match'})`);

    if (matched) {
        console.log(`PARAMS:`, matches[0].params);
        console.log(`HANDLERS:`, matches[0].handlers.length);
    }
    console.log('');
});