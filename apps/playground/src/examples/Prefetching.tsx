import { Query, useQuery, useQueryClient } from "@effect-atom-query/react";
import { useState } from "react";
import { Api } from "../api.ts";
import { runtime } from "../runtime.ts";
import { errorMessage, type Example, Status } from "../ui.tsx";

const charactersQuery = Query.single({
  key: ["characters"],
  run: Api.use((api) => api.characters),
});

const characterQuery = Query.make({
  key: (id: number) => ["character", id],
  run: (id) => Api.use((api) => api.character(id)),
  staleTime: "10 seconds",
});

function Character({ id }: { readonly id: number }) {
  const character = useQuery(characterQuery(id));
  if (character.isPending) return <p>Loading... (800 ms without prefetching)</p>;
  if (character.isError) return <p>Error: {errorMessage(character)}</p>;
  const { name, species, homeworld } = character.data.value;
  return (
    <div>
      <h3>{name}</h3>
      <p>
        {species} from {homeworld}
      </p>
      <Status result={character} />
    </div>
  );
}

function Prefetching() {
  const client = useQueryClient();
  const characters = useQuery(charactersQuery);
  const [selected, setSelected] = useState<number | undefined>(undefined);

  // The imperative API is Effect-only: run it on the app runtime.
  const prefetch = (id: number) => runtime.runFork(client.prefetchQuery(characterQuery(id)));

  return (
    <div>
      <p>Hover a name to prefetch its details; clicking then shows them instantly.</p>
      <div style={{ display: "flex", gap: 24 }}>
        <ul>
          {characters.isSuccess
            ? characters.data.value.map((c) => (
                <li key={c.id}>
                  <a
                    href="#prefetching"
                    onMouseEnter={() => prefetch(c.id)}
                    onFocus={() => prefetch(c.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      setSelected(c.id);
                    }}
                  >
                    {c.name}
                  </a>
                </li>
              ))
            : "Loading..."}
        </ul>
        {selected === undefined ? null : <Character id={selected} />}
      </div>
    </div>
  );
}

export const example: Example = {
  id: "prefetching",
  title: "Prefetching",
  tanstack: "prefetching",
  description: "client.prefetchQuery on hover, run as an Effect on the app runtime.",
  Component: Prefetching,
};
