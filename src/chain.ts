export type AsyncFn<Prev extends object, R extends object, T> = (prev: Prev, args: T) => Promise<R>;

export interface Chain<Acc extends object = {}, T = undefined> {
    add<R extends object>(fn: AsyncFn<Acc, R, T>): Chain<Acc & R, T>;
    run(args: T): Promise<Acc>;
}

export function createChain<Acc extends object = {}, T = undefined>(fns: Array<AsyncFn<any, object, T>> = []): Chain<Acc, T> {
    return {
        add<R extends object>(fn: AsyncFn<Acc, R, T>) {
            return createChain<Acc & R, T>([...fns, fn]);
        },
        async run(args: T) {
            let acc = {} as Acc;
            for (const fn of fns) {
                const result = await fn(acc, args);
                acc = { ...acc, ...result };
            }
            return acc;
        }
    };
}