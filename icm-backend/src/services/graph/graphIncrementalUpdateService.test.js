import {
  computeEdgeMutationPlan,
  edgeIdentityKey,
  parseEdgeIdentityKey,
} from "./graphIncrementalUpdateService.js";

describe("computeEdgeMutationPlan (Iteration #1)", () => {
  test("unchanged memberships are neither deleted nor inserted", () => {
    const desired = new Set(["u1|g1|MEMBER_OF", "u2|g1|MEMBER_OF", "g2|g1|NESTED_MEMBER"]);
    const existing = new Set(["u1|g1|MEMBER_OF", "u2|g1|MEMBER_OF", "g2|g1|NESTED_MEMBER"]);

    const plan = computeEdgeMutationPlan(desired, existing);

    expect(plan.toDeleteKeys).toEqual([]);
    expect(plan.toInsertKeys).toEqual([]);
    expect(plan.unchanged).toBe(3);
    expect(plan.desiredCount).toBe(3);
    expect(plan.existingCount).toBe(3);
  });

  test("deleted memberships produce deletes only", () => {
    const desired = new Set(["u1|g1|MEMBER_OF"]);
    const existing = new Set(["u1|g1|MEMBER_OF", "u2|g1|MEMBER_OF"]);

    const plan = computeEdgeMutationPlan(desired, existing);

    expect(plan.toDeleteKeys).toEqual(["u2|g1|MEMBER_OF"]);
    expect(plan.toInsertKeys).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  test("new memberships produce inserts only", () => {
    const desired = new Set(["u1|g1|MEMBER_OF", "u3|g1|MEMBER_OF"]);
    const existing = new Set(["u1|g1|MEMBER_OF"]);

    const plan = computeEdgeMutationPlan(desired, existing);

    expect(plan.toDeleteKeys).toEqual([]);
    expect(plan.toInsertKeys).toEqual(["u3|g1|MEMBER_OF"]);
    expect(plan.unchanged).toBe(1);
  });

  test("mixed delta: delete stale + insert new; leave intersection untouched", () => {
    const desired = new Map([
      ["a|b|MEMBER_OF", { sourceNodeId: "a", targetNodeId: "b", relationshipType: "MEMBER_OF" }],
      ["c|d|MEMBER_OF", { sourceNodeId: "c", targetNodeId: "d", relationshipType: "MEMBER_OF" }],
    ]);
    const existing = new Set(["a|b|MEMBER_OF", "x|y|MEMBER_OF"]);

    const plan = computeEdgeMutationPlan(desired, existing);

    expect(plan.toDeleteKeys.sort()).toEqual(["x|y|MEMBER_OF"]);
    expect(plan.toInsertKeys.sort()).toEqual(["c|d|MEMBER_OF"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.desiredCount).toBe(2);
    expect(plan.existingCount).toBe(2);
  });

  test("edgeIdentityKey + parseEdgeIdentityKey round-trip for normal ids", () => {
    const edge = {
      sourceNodeId: "tenant:app:user:guid",
      targetNodeId: "tenant:app:group:sid",
      relationshipType: "MEMBER_OF",
    };
    const key = edgeIdentityKey(edge);
    expect(parseEdgeIdentityKey(key)).toEqual(edge);
  });
});
