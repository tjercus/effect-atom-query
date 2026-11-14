import { Query, useQuery } from "@effect-native-query/react";
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
      {posts.isPending ? (
        "Loading..."
      ) : posts.isError ? (
        <span>Error: {errorMessage(posts)}</span>
      ) : (
        <>
          <ul>
            {posts.data.value.map((post) => (
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
      )}
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
      {post.isPending ? (
        <p>Loading...</p>
      ) : post.isError ? (
        <p>Error: {errorMessage(post)}</p>
      ) : (
        <>
          <h3>{post.data.value.title}</h3>
          <p>{post.data.value.body}</p>
          <div>{post.isFetching ? "Background Updating..." : " "}</div>
        </>
      )}
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
