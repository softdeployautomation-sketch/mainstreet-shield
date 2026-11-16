"use client";

import { useState } from "react";

export function WorkflowForm({ companyId, userId }: { companyId: string; userId: string }) {
  const [stepCount, setStepCount] = useState(1);

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-emerald-400 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">New Test Workflow</h1>
      </div>

      <form
        className="max-w-2xl bg-zinc-900/50 rounded-xl border border-zinc-800 p-6"
        action="/api/workflows"
        method="POST"
      >
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="createdById" value={userId} />

        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Workflow Name</label>
          <input
            name="name"
            type="text"
            required
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            placeholder="e.g. Quarterly Penetration Test"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Description</label>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            placeholder="What does this workflow test and why?"
          ></textarea>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Steps</label>
          <div className="space-y-2" id="steps-list">
            {[...Array(stepCount)].map((_, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name={`steps[${i}].name`}
                  type="text"
                  required
                  placeholder={`Step ${i + 1} name`}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
                <input
                  name={`steps[${i}].tool`}
                  type="text"
                  placeholder="Tool (optional)"
                  className="w-48 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStepCount((c) => c + 1)}
            className="text-xs text-emerald-400 hover:underline"
          >
            + Add step
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Create Workflow
          </button>
          <a
            href="/dashboard"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 text-center hover:bg-zinc-800/50"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
