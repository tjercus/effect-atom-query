/**
 * A fake backend as an Effect service, so examples run offline with realistic
 * latency and failures. Queries depend on `Api`; the runtime provides it.
 */
import { Context, DateTime, Effect, Layer, Option, Result, Schema } from "effect";

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
}) {}

export const Post = Schema.Struct({ id: Schema.Number, title: Schema.String, body: Schema.String });
export type Post = typeof Post.Type;

export const Project = Schema.Struct({ id: Schema.Number, name: Schema.String });
export type Project = typeof Project.Type;

export const FeedPage = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.Number, text: Schema.String })),
  previous: Schema.Option(Schema.Number),
  next: Schema.Option(Schema.Number),
});
export type FeedPage = typeof FeedPage.Type;

export const Todo = Schema.Struct({ id: Schema.Number, text: Schema.String });
export type Todo = typeof Todo.Type;

/** A stored todo list: JSON, validated when read back. */
const decodeStoredTodos = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Todo)));

export const User = Schema.Struct({ id: Schema.Number, email: Schema.String, name: Schema.String });
export type User = typeof User.Type;

export const Character = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  species: Schema.String,
  homeworld: Schema.String,
});
export type Character = typeof Character.Type;

export class Api extends Context.Service<
  Api,
  {
    readonly repo: Effect.Effect<{ name: string; stars: number; forks: number; watchers: number }>;
    readonly posts: Effect.Effect<ReadonlyArray<Post>, ApiError>;
    readonly post: (id: number) => Effect.Effect<Post, ApiError>;
    readonly projects: (
      page: number,
    ) => Effect.Effect<{ projects: ReadonlyArray<Project>; hasMore: boolean }, ApiError>;
    /** Cursor-paginated in both directions around 0. */
    readonly feed: (cursor: number) => Effect.Effect<FeedPage, ApiError>;
    readonly todos: (list: string) => Effect.Effect<ReadonlyArray<Todo>, ApiError>;
    /** Rejects texts containing "fail". */
    readonly addTodo: (list: string, text: string) => Effect.Effect<Todo, ApiError>;
    readonly clearTodos: (list: string) => Effect.Effect<void, ApiError>;
    readonly userByEmail: (email: string) => Effect.Effect<User, ApiError>;
    readonly projectsOf: (userId: number) => Effect.Effect<ReadonlyArray<Project>, ApiError>;
    readonly characters: Effect.Effect<ReadonlyArray<Pick<Character, "id" | "name">>, ApiError>;
    readonly character: (id: number) => Effect.Effect<Character, ApiError>;
    /** Make the next request fail (for error boundary demos). */
    readonly failNext: Effect.Effect<void>;
  }
>()("playground/Api") {}

const latency = (millis: number) =>
  Effect.sleep(`${millis + Math.round(Math.random() * 150)} millis`);

const names = ["Atlas", "Borealis", "Cygnus", "Draco", "Eridanus", "Fornax", "Gemini", "Hydra"];

const characters: ReadonlyArray<Character> = [
  { id: 1, name: "Luma Skywright", species: "Human", homeworld: "Tessar" },
  { id: 2, name: "K-7 Pathfinder", species: "Droid", homeworld: "Orbital Yard 3" },
  { id: 3, name: "Orren Vale", species: "Zabri", homeworld: "Mirevale" },
  { id: 4, name: "Sefa Drummond", species: "Human", homeworld: "Calder" },
  { id: 5, name: "Tock", species: "Ewoq", homeworld: "Fennmoor" },
];

const makeApi = (options: { readonly latency: boolean }): Api["Service"] => {
  /** Simulated network latency; tests turn it off. */
  const wait = (millis: number): Effect.Effect<void> =>
    options.latency ? latency(millis) : Effect.void;
  let failNext = false;
  const todoLists = new Map<string, Array<Todo>>();
  let nextTodoId = 100;
  // The fake server keeps its todo lists in localStorage, so persisted client
  // caches and resumed mutations stay consistent across reloads.
  const storageKey = (name: string) => `playground-api/todos/${name}`;
  // localStorage throws when it is unavailable (e.g. blocked site data): the
  // fake server then keeps its lists in memory only.
  let warned = false;
  const storageUnavailable = (error: unknown) => {
    if (!warned) {
      warned = true;
      console.warn("playground-api: localStorage is unavailable, todos stay in memory", error);
    }
  };
  const save = (name: string) => {
    const saved = Result.try(() =>
      localStorage.setItem(storageKey(name), JSON.stringify(todoLists.get(name) ?? [])),
    );
    if (Result.isFailure(saved)) {
      storageUnavailable(saved.failure);
    }
  };
  /** The stored list, if there is one that is valid. */
  const load = (name: string): Option.Option<Array<Todo>> => {
    const stored = Result.try(() => localStorage.getItem(storageKey(name)));
    if (Result.isFailure(stored)) {
      storageUnavailable(stored.failure);
      return Option.none();
    }
    return Option.fromNullishOr(stored.success).pipe(
      Option.flatMap(decodeStoredTodos),
      Option.map((todos) => todos.slice()),
    );
  };
  const list = (name: string): Array<Todo> => {
    let l = todoLists.get(name);
    if (l === undefined) {
      l = Option.getOrElse(load(name), () => [
        { id: 1, text: "learn Effect" },
        { id: 2, text: "try effect-atom-query" },
      ]);
      todoLists.set(name, l);
      nextTodoId = Math.max(nextTodoId, ...l.map((t) => t.id + 1));
    }
    return l;
  };

  /** Latency, then fail if `failNext` was armed. */
  const request = <A>(millis: number, f: () => A): Effect.Effect<A, ApiError> =>
    wait(millis).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (failNext) {
            failNext = false;
            return Effect.fail(new ApiError({ message: "The server had a bad day (failNext)" }));
          }
          return Effect.sync(f);
        }),
      ),
    );

  return {
    repo: wait(400).pipe(
      Effect.as({
        name: "effect-atom-query",
        stars: 1200 + Math.round(Math.random() * 50),
        forks: 42,
        watchers: 37,
      }),
    ),
    posts: request(500, () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `Post ${i + 1}: notes on ${names[i % names.length]}`,
        body: `Body of post ${i + 1}.`,
      })),
    ),
    post: (id) =>
      request(400, () => undefined).pipe(
        Effect.andThen(DateTime.now),
        Effect.map((fetchedAt) => ({
          id,
          title: `Post ${id}: notes on ${names[(id - 1) % names.length]}`,
          body: `This is the full body of post ${id}, fetched at ${DateTime.formatLocal(fetchedAt, { timeStyle: "medium" })}.`,
        })),
      ),
    projects: (page) =>
      request(600, () => ({
        projects: Array.from({ length: 5 }, (_, i) => ({
          id: page * 5 + i,
          name: `Project ${page * 5 + i + 1}`,
        })),
        hasMore: page < 9,
      })),
    feed: (cursor) =>
      request(500, () => ({
        items: Array.from({ length: 5 }, (_, i) => ({
          id: cursor * 5 + i,
          text: `Item ${cursor * 5 + i}`,
        })),
        previous: cursor > -5 ? Option.some(cursor - 1) : Option.none(),
        next: cursor < 5 ? Option.some(cursor + 1) : Option.none(),
      })),
    todos: (name) => request(300, () => list(name).slice()),
    addTodo: (name, text) =>
      wait(700).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (text.toLowerCase().includes("fail")) {
              return Effect.fail(new ApiError({ message: `Rejected "${text}"` }));
            }
            const todo = { id: nextTodoId++, text };
            list(name).push(todo);
            save(name);
            return Effect.succeed(todo);
          }),
        ),
      ),
    clearTodos: (name) =>
      request(300, () => {
        todoLists.set(name, []);
        save(name);
      }),
    userByEmail: (email) =>
      request(500, () => ({ id: email.length, email, name: email.split("@")[0] ?? email })),
    projectsOf: (userId) =>
      request(500, () =>
        Array.from({ length: 3 }, (_, i) => ({
          id: userId * 10 + i,
          name: `${names[i]} for #${userId}`,
        })),
      ),
    characters: request(400, () => characters.map(({ id, name }) => ({ id, name }))),
    character: (id) =>
      request(800, () => characters.find((c) => c.id === id)).pipe(
        Effect.flatMap((c) =>
          c === undefined
            ? Effect.fail(new ApiError({ message: `No character ${id}` }))
            : Effect.succeed(c),
        ),
      ),
    failNext: Effect.sync(() => {
      failNext = true;
    }),
  };
};

export const ApiLive: Layer.Layer<Api> = Layer.sync(Api, () => makeApi({ latency: true }));

/** The same fake server without latency, for tests. */
export const ApiNoLatency: Layer.Layer<Api> = Layer.sync(Api, () => makeApi({ latency: false }));
