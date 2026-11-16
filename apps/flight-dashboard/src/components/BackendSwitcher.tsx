import { type BackendChoice, describeLayer } from "../runtime.ts";
import { chaosStore, useStore } from "../store.ts";

export interface BackendSwitcherProps {
  readonly choice: BackendChoice;
  readonly onChange: (choice: BackendChoice) => void;
}

export function BackendSwitcher({ choice, onChange }: BackendSwitcherProps) {
  const chaos = useStore(chaosStore);
  return (
    <section className="switcher">
      <fieldset>
        <legend>Backend layer</legend>
        <label>
          <input
            type="radio"
            name="backend"
            checked={choice.backend === "http"}
            onChange={() => onChange({ ...choice, backend: "http" })}
          />{" "}
          HTTP (<code>fetch</code> to the dev server)
        </label>
        <label>
          <input
            type="radio"
            name="backend"
            checked={choice.backend === "memory"}
            onChange={() => onChange({ ...choice, backend: "memory" })}
          />{" "}
          In memory (also used by the tests)
        </label>
        <label>
          <input
            type="checkbox"
            checked={choice.chaos}
            onChange={(e) => onChange({ ...choice, chaos: e.target.checked })}
          />{" "}
          Wrap it in the chaos layer
        </label>
      </fieldset>

      {/* Read by the chaos layer on every request, so moving these keeps the cache. */}
      <fieldset disabled={!choice.chaos}>
        <legend>Chaos</legend>
        <label>
          Failures {Math.round(chaos.failureRate * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={chaos.failureRate}
            onChange={(e) => chaosStore.set((s) => ({ ...s, failureRate: Number(e.target.value) }))}
          />
        </label>
        <label>
          Defects {Math.round(chaos.defectRate * 100)}%
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={chaos.defectRate}
            onChange={(e) => chaosStore.set((s) => ({ ...s, defectRate: Number(e.target.value) }))}
          />
        </label>
        <label>
          Extra latency {chaos.extraLatencyMs} ms
          <input
            type="range"
            min={0}
            max={3000}
            step={100}
            value={chaos.extraLatencyMs}
            onChange={(e) =>
              chaosStore.set((s) => ({ ...s, extraLatencyMs: Number(e.target.value) }))
            }
          />
        </label>
      </fieldset>

      <pre className="layer-code">
        <code>{describeLayer(choice)}</code>
      </pre>
    </section>
  );
}
