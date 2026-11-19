import { Query, QueryResult, useQuery, useQueryClient } from "@effect-atom-query/react";
import { Option } from "effect";
import { useState } from "react";
import { Api, type Character as CharacterData } from "../api.ts";
import { runtime } from "../runtime.ts";
import { errorMessage, type Example, StaleDataError, Status } from "../ui.tsx";

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
  const view = ({ name, species, homeworld }: CharacterData) => (
    <>
      <h3>{name}</h3>
      <p>
        {species} from {homeworld}
      </p>
      <Status result={character} />
    </>
  );
  return QueryResult.match(character, {
    onPending: () => <p>Loading... (800 ms without prefetching)</p>,
    // A failed refetch keeps the details it already has.
    onFailure: (failure) =>
      Option.match(failure.data, {
        onNone: () => <p>Error: {errorMessage(failure)}</p>,
        onSome: (data) => (
          <div>
            {view(data)}
            <StaleDataError failure={failure} />
          </div>
        ),
      }),
    onSuccess: (success) => <div>{view(success.data.value)}</div>,
  });
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
          {QueryResult.match(characters, {
            onPending: () => <li>Loading...</li>,
            onFailure: (failure) => <li>Error: {errorMessage(failure)}</li>,
            onSuccess: (success) =>
              success.data.value.map((c) => (
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
              )),
          })}
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
