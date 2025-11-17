export type AsyncFn<Prev extends object, R extends object | void, T> = (prev: Prev, args: T) => Promise<R>;

export interface Chain<Acc extends object = {}, T = void> {
    add<R extends object | void>(fn: AsyncFn<Acc, R, T>): Chain<Acc & R, T>;
    run(args: T): Promise<boolean>;
}

export function createChain<Acc extends object = {}, T = void>(fns: Array<AsyncFn<any, object | void, T>> = []): Chain<Acc, T> {
    return {
        add<R extends object | void>(fn: AsyncFn<Acc, R, T>) {
            return createChain<Acc & R, T>([...fns, fn]);
        },
        async run(args: T) {
            let acc = {} as Acc;
            for (const fn of fns) {
                const result = await fn(acc, args);
                if (typeof result === 'undefined') {
                    return false;
                }
                acc = { ...acc, ...result };
            }
            return true;
        }
    };
}