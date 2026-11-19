import { Query, QueryResult, useQuery } from "@effect-atom-query/react";
import { useState } from "react";
import { Api } from "../api.ts";
import { errorMessage, type Example } from "../ui.tsx";

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
  return (
    <div>
      <h3>Posts</h3>
      {QueryResult.match(posts, {
        onPending: () => "Loading...",
        onFailure: (failure) => <span>Error: {errorMessage(failure)}</span>,
        onSuccess: (success) => (
          <>
            <ul>
              {success.data.value.map((post) => (
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
            <div>{success.isFetching ? "Background Updating..." : " "}</div>
          </>
        ),
      })}
    </div>
  );
}

function Post({ id, onBack }: { readonly id: number; readonly onBack: () => void }) {
  const post = useQuery(postQuery(id));
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
        onFailure: (failure) => <p>Error: {errorMessage(failure)}</p>,
        onSuccess: (success) => (
          <>
            <h3>{success.data.value.title}</h3>
            <p>{success.data.value.body}</p>
            <div>{success.isFetching ? "Background Updating..." : " "}</div>
          </>
        ),
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
