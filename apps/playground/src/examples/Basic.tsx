import { Query, QueryResult, useQuery } from "@effect-atom-query/react";
import { Option } from "effect";
import { useState } from "react";
import { Api, type Post as PostData } from "../api.ts";
import { errorMessage, type Example, StaleDataError } from "../ui.tsx";

const postsQuery = Query.single({
  key: ["posts"],
  run: Api.use((api) => api.posts),
});

const postQuery = Query.make({
  key: (id: number) => ["post", id],
  run: (id) => Api.use((api) => api.post(id)),
});

function Posts({ onSelect }: { readonly onSelect: (id: number) => void }) {
  const posts = useQuery(postsQuery);
  const view = (list: ReadonlyArray<PostData>) => (
    <>
      <ul>
        {list.map((post) => (
          <li key={post.id}>
            <a
              href="#basic"
              onClick={(e) => {
                e.preventDefault();
                onSelect(post.id);
              }}
            >
              {post.title}
            </a>
          </li>
        ))}
      </ul>
      <div>{posts.isFetching ? "Background Updating..." : " "}</div>
    </>
  );
  return (
    <div>
      <h3>Posts</h3>
      {QueryResult.match(posts, {
        onPending: () => "Loading...",
        // A failed refetch keeps the posts it already has.
        onFailure: (failure) =>
          Option.match(failure.data, {
            onNone: () => <span>Error: {errorMessage(failure)}</span>,
            onSome: (list) => (
              <>
                {view(list)}
                <StaleDataError failure={failure} />
              </>
            ),
          }),
        onSuccess: (success) => view(success.data.value),
      })}
    </div>
  );
}

function Post({ id, onBack }: { readonly id: number; readonly onBack: () => void }) {
  const post = useQuery(postQuery(id));
  const view = ({ title, body }: PostData) => (
    <>
      <h3>{title}</h3>
      <p>{body}</p>
      <div>{post.isFetching ? "Background Updating..." : " "}</div>
    </>
  );
  return (
    <div>
      <a
        href="#basic"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        ← Back
      </a>
      {QueryResult.match(post, {
        onPending: () => <p>Loading...</p>,
        onFailure: (failure) =>
          Option.match(failure.data, {
            onNone: () => <p>Error: {errorMessage(failure)}</p>,
            onSome: (data) => (
              <>
                {view(data)}
                <StaleDataError failure={failure} />
              </>
            ),
          }),
        onSuccess: (success) => view(success.data.value),
      })}
    </div>
  );
}

function Basic() {
  const [postId, setPostId] = useState<number | undefined>(undefined);
  return postId === undefined ? (
    <Posts onSelect={setPostId} />
  ) : (
    <Post id={postId} onBack={() => setPostId(undefined)} />
  );
}

export const example: Example = {
  id: "basic",
  title: "Basic",
  tanstack: "basic",
  description:
    "A list and a parameterised detail query (Query.make is a family). Going back shows cached posts instantly while they refetch in the background.",
  Component: Basic,
};
