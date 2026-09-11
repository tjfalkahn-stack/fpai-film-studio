import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SLOT_KEYS,
  COVERAGE_RULES,
  applyPersistedCanonicalSlots,
  buildCharacterLockManifest,
  evaluateReferenceCoverage,
  inferShotContext,
  migrateLegacyCharacterRefs,
  normalizeLibraryAsset,
  selectGenerationReferences,
  shouldInvalidateLock,
  syncCanonicalRefsFromLibrary,
} from "./characterReferences.js";
import { isCharacterReferenceComplete, mergeSavedCharacters, normalizeCharacter as normalizeDomainCharacter } from "./domain.js";
import { validateReferenceFile } from "./imageMeta.js";
import { makeJpeg, makePng, makeWebp } from "../tests/imageFixtures.js";

function asset(id, extra = {}) {
  return normalizeLibraryAsset({
    id,
    projectId: "enemies-closer-ep01",
    characterId: extra.characterId || "jasmine",
    filename: `${id}.png`,
    mimeType: "image/png",
    byteSize: 1200,
    width: extra.width || 1024,
    height: extra.height || 1024,
    contentHash: extra.contentHash || id,
    category: extra.category || "other",
    angle: extra.angle || "",
    expression: extra.expression || "",
    wardrobe: extra.wardrobe || "",
    approvalState: extra.approvalState || "approved",
    isPrimary: extra.isPrimary || false,
    isIdentityAnchor: extra.isIdentityAnchor || false,
    includeInGeneration: extra.includeInGeneration ?? true,
    sortOrder: extra.sortOrder ?? 0,
    ...extra,
  });
}

test("legacy masterFace and identityFront migrate to a Primary Identity library entry without data loss", () => {
  const character = {
    id: "jasmine",
    wardrobe: "Tarmac Look 01",
    refs: {
      masterFace: { key: "old-master-face", name: "front.png", uploadedAt: "2026-09-01T00:00:00.000Z" },
      profile: { key: "profile-key", name: "profile.png" },
    },
    expressions: { Neutral: { key: "expr-neutral", name: "neutral.png" } },
  };
  const migrated = migrateLegacyCharacterRefs(character);
  assert.equal(migrated[0].mediaKey, "old-master-face");
  assert.equal(migrated[0].isPrimary, true);
  assert.equal(migrated[0].isIdentityAnchor, true);
  assert.equal(migrated[0].category, "identity_anchor");
  assert.equal(migrated.some((item) => item.mediaKey === "profile-key"), true);
  assert.equal(migrated.some((item) => item.expression === "neutral"), true);
  assert.equal(migrated.filter((item) => item.isPrimary).length, 1);
});

test("canonical Character Bible lock still requires the five stored slots", () => {
  const character = normalizeDomainCharacter({
    id: "marcus",
    locked: true,
    refs: { identityFront: { key: "media:front" } },
  });
  assert.equal(isCharacterReferenceComplete(character), false);
  assert.equal(character.locked, false);
});

test("file validation accepts JPG PNG WebP and rejects wrong types, tiny files, and mismatched headers", () => {
  const png = makePng(64, 64);
  const jpeg = makeJpeg(64, 64);
  const webp = makeWebp(64, 64);
  assert.equal(validateReferenceFile({ bytes: png, mimeType: "image/png", filename: "a.png" }).ok, true);
  assert.equal(validateReferenceFile({ bytes: jpeg, mimeType: "image/jpeg", filename: "a.jpg" }).ok, true);
  assert.equal(validateReferenceFile({ bytes: webp, mimeType: "image/webp", filename: "a.webp" }).ok, true);
  assert.equal(validateReferenceFile({ bytes: png, mimeType: "image/gif", filename: "a.gif" }).ok, false);
  assert.equal(validateReferenceFile({ bytes: png, mimeType: "image/jpeg", filename: "a.jpg" }).ok, false);
  assert.equal(validateReferenceFile({ bytes: makePng(32, 32), mimeType: "image/png", filename: "tiny.png" }).ok, false);
  assert.match(
    validateReferenceFile({ bytes: Buffer.from("not-an-image"), mimeType: "image/png", filename: "x.png" }).errors[0],
    /recognizable/,
  );
});

test("reference coverage lists missing views instead of only a percentage", () => {
  const coverage = evaluateReferenceCoverage([
    asset("p1", { isPrimary: true, category: "identity_anchor", angle: "front", isIdentityAnchor: true }),
  ]);
  assert.ok(coverage.score < 1);
  assert.ok(coverage.missing.includes("At least three approved identity anchors"));
  assert.ok(coverage.missing.includes("Three-quarter view present"));
  assert.ok(coverage.missing.includes("Profile view present"));
  assert.ok(coverage.missing.includes("Full-body reference present"));
  assert.ok(coverage.missing.includes("Expression coverage"));
  assert.equal(coverage.disclaimer.includes("does not guarantee"), true);
  assert.equal(coverage.total, COVERAGE_RULES.length);
});

test("full coverage checklist passes when required views, anchors, expressions, and resolution exist", () => {
  const library = [
    asset("p", { isPrimary: true, isIdentityAnchor: true, category: "identity_anchor", angle: "front", expression: "neutral" }),
    asset("a2", { isIdentityAnchor: true, category: "identity_anchor", angle: "front" }),
    asset("a3", { isIdentityAnchor: true, category: "face_closeup", angle: "front" }),
    asset("tq", { category: "three_quarter", angle: "three_quarter_left" }),
    asset("pr", { category: "profile", angle: "profile_right" }),
    asset("fb", { category: "full_body" }),
    asset("ex1", { category: "expression", expression: "crying" }),
    asset("ex2", { category: "expression", expression: "smiling" }),
  ];
  const coverage = evaluateReferenceCoverage(library);
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.metCount, coverage.total);
});

test("duplicate content hashes fail the duplicate coverage rule", () => {
  const coverage = evaluateReferenceCoverage([
    asset("one", { contentHash: "abc", isPrimary: true, category: "front", angle: "front" }),
    asset("two", { contentHash: "abc", category: "other" }),
  ]);
  assert.equal(coverage.rules.find((rule) => rule.id === "duplicates").met, false);
});

test("character lock manifests are versioned and become stale after approved reference changes", () => {
  const library = [
    asset("p", { isPrimary: true, isIdentityAnchor: true, category: "identity_anchor" }),
    asset("a", { isIdentityAnchor: true, category: "identity_anchor" }),
    asset("s", { category: "full_body" }),
    asset("x", { category: "other", approvalState: "excluded", includeInGeneration: false }),
  ];
  const v1 = buildCharacterLockManifest({
    projectId: "enemies-closer-ep01",
    characterId: "jasmine",
    lockVersion: 1,
    assets: library,
    createdAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(v1.schema, "fpai.character-lock.v1");
  assert.equal(v1.primaryIdentityAsset.id, "p");
  assert.equal(v1.approvedIdentityAnchors[0].id, "a");
  assert.equal(v1.supplementalReferences[0].id, "s");
  assert.equal(v1.excludedImages[0].id, "x");
  assert.equal(shouldInvalidateLock(v1, library), false);
  assert.equal(
    shouldInvalidateLock(v1, [...library, asset("new", { category: "expression", expression: "crying" })]),
    true,
  );
  const v2 = buildCharacterLockManifest({
    projectId: v1.projectId,
    characterId: v1.characterId,
    lockVersion: 2,
    assets: [...library, asset("new", { category: "expression", expression: "crying" })],
    createdAt: "2026-09-10T01:00:00.000Z",
  });
  assert.equal(v2.lockVersion, 2);
  assert.notEqual(v2.createdAt, v1.createdAt);
});

test("generation selection is deterministic, prefers primary + crying + full-body, and honors provider limits", () => {
  const jasmine = [
    asset("primary", { isPrimary: true, isIdentityAnchor: true, category: "identity_anchor", angle: "front", sortOrder: 0 }),
    asset("anchor-b", { isIdentityAnchor: true, category: "identity_anchor", angle: "front", sortOrder: 1 }),
    asset("anchor-c", { isIdentityAnchor: true, category: "face_closeup", angle: "front", sortOrder: 2 }),
    asset("cry-front", { category: "expression", expression: "crying", angle: "front", sortOrder: 3 }),
    asset("smile", { category: "expression", expression: "smiling", sortOrder: 4 }),
    asset("body", { category: "full_body", angle: "front", sortOrder: 5 }),
    asset("profile", { category: "profile", angle: "profile_left", sortOrder: 6 }),
    asset("excluded", { category: "other", approvalState: "excluded", includeInGeneration: false, sortOrder: 7 }),
  ];
  const shot = { id: "010", subject: "Jasmine crying, medium handheld reveal", move: "Handheld reveal" };
  const first = selectGenerationReferences({
    characters: [{ id: "jasmine", name: "Jasmine" }],
    libraries: { jasmine },
    shot,
    supportingLimit: 5,
    providerMaxReferences: 6,
    lockVersions: { jasmine: 3 },
  });
  const second = selectGenerationReferences({
    characters: [{ id: "jasmine", name: "Jasmine" }],
    libraries: { jasmine },
    shot,
    supportingLimit: 5,
    providerMaxReferences: 6,
    lockVersions: { jasmine: 3 },
  });
  assert.deepEqual(first.selected.map((item) => item.assetId), second.selected.map((item) => item.assetId));
  assert.equal(first.selected[0].assetId, "primary");
  assert.equal(first.selected[0].reasons.includes("primary-identity"), true);
  assert.equal(first.selected.some((item) => item.assetId === "cry-front"), true);
  assert.equal(first.selected.find((item) => item.assetId === "cry-front").reasons.includes("matching-expression:crying"), true);
  assert.equal(first.selected.some((item) => item.assetId === "body"), true);
  assert.equal(first.selected.some((item) => item.assetId === "excluded"), false);
  assert.equal(first.selected.length <= 6, true);
  assert.equal(first.lockVersions.jasmine, 3);

  const one = selectGenerationReferences({
    characters: [{ id: "jasmine", name: "Jasmine" }],
    libraries: { jasmine },
    shot,
    supportingLimit: 5,
    providerMaxReferences: 1,
  });
  assert.equal(one.transmitted.length, 1);
  assert.equal(one.transmitted[0].assetId, "primary");
  assert.equal(one.fallbackApplied, true);
  assert.match(one.limitation, /at most 1 reference image/);
  assert.equal(one.selected.length > 1, true);
});

test("close-ups prefer face references and wide shots prefer full-body", () => {
  const library = [
    asset("primary", { isPrimary: true, category: "identity_anchor", angle: "front" }),
    asset("face", { category: "face_closeup", angle: "front" }),
    asset("body", { category: "full_body" }),
  ];
  const close = selectGenerationReferences({
    characters: [{ id: "mikey", name: "Mikey" }],
    libraries: { mikey: library.map((item) => ({ ...item, characterId: "mikey" })) },
    shot: { subject: "Mikey wet eye — ECU" },
    supportingLimit: 5,
  });
  assert.equal(close.selected.some((item) => item.assetId === "face"), true);
  const wide = selectGenerationReferences({
    characters: [{ id: "mikey", name: "Mikey" }],
    libraries: { mikey: library.map((item) => ({ ...item, characterId: "mikey" })) },
    shot: { subject: "Airfield aerial / fire / jet", move: "Aggressive drone dive" },
    supportingLimit: 5,
  });
  assert.equal(wide.selected.some((item) => item.assetId === "body"), true);
});

test("inferShotContext reads crying and close-up language from existing seed shot copy", () => {
  assert.equal(inferShotContext({ subject: "BLACK / Mikey crying" }).expression, "crying");
  assert.equal(inferShotContext({ subject: "Mikey wet eye — ECU" }).framing, "closeup");
  assert.equal(inferShotContext({ subject: "Jasmine holding Mikey", prompt: "Jasmine crying" }).expression, "crying");
});

test("library first-match cannot overwrite persisted Character Bible slots", () => {
  const character = {
    id: "jasmine",
    refs: {
      identityFront: { key: "char:jasmine:identityFront:1", name: "owner-approved.png" },
      strayRain: { key: "rain" },
    },
  };
  const seeded = asset("seed-front", { isPrimary: true, category: "identity_anchor", sortOrder: 0 });
  const approved = asset("approved-front", { category: "identity_anchor", sortOrder: 1 });
  const refs = syncCanonicalRefsFromLibrary(
    character,
    [
      seeded,
      approved,
      asset("pr", { category: "profile", angle: "profile_left" }),
      asset("fb", { category: "full_body" }),
      asset("ex", { category: "expression", expression: "crying" }),
      asset("w", { category: "wardrobe" }),
    ],
    { identityFront: approved },
  );
  assert.equal(refs.identityFront.assetId, "approved-front");
  assert.equal(refs.identityFront.canonical, true);
  assert.notEqual(refs.identityFront.assetId, "seed-front");
  assert.equal(refs.profile, undefined);
  assert.equal(refs.strayRain.key, "rain");
});

test("without persisted assignments, library category inference does not fill canonical slots", () => {
  const character = {
    id: "jasmine",
    refs: { identityFront: { key: "char:jasmine:identityFront:1", name: "local.png" } },
  };
  const refs = syncCanonicalRefsFromLibrary(character, [
    asset("p", { isPrimary: true, category: "identity_anchor" }),
    asset("pr", { category: "profile", angle: "profile_left" }),
    asset("fb", { category: "full_body" }),
    asset("ex", { category: "expression", expression: "crying" }),
    asset("w", { category: "wardrobe" }),
  ]);
  assert.equal(refs.identityFront.key, "char:jasmine:identityFront:1");
  assert.equal(refs.profile, undefined);
  assert.equal(refs.fullBody, undefined);
  assert.equal(refs.expression, undefined);
  assert.equal(refs.wardrobe, undefined);
});

test("inferred library keys are dropped when no persisted canonical assignment exists", () => {
  const character = {
    id: "mikey",
    refs: { identityFront: { key: "library:seed-front", source: "library", assetId: "seed-front" } },
  };
  const refs = syncCanonicalRefsFromLibrary(
    character,
    [asset("seed-front", { isPrimary: true, category: "identity_anchor" })],
    {},
  );
  assert.equal(refs.identityFront, undefined);
});

test("replacing one persisted slot leaves the other four canonical assignments intact", () => {
  const character = { id: "marcus", refs: {} };
  const slots = {
    identityFront: asset("front-1", { category: "identity_anchor" }),
    profile: asset("profile-1", { category: "profile" }),
    fullBody: asset("body-1", { category: "full_body" }),
    expression: asset("expr-1", { category: "expression" }),
    wardrobe: asset("ward-1", { category: "wardrobe" }),
  };
  const afterOne = applyPersistedCanonicalSlots(character, {
    ...slots,
    identityFront: asset("front-2", { category: "identity_anchor" }),
  });
  assert.equal(afterOne.identityFront.assetId, "front-2");
  assert.equal(afterOne.profile.assetId, "profile-1");
  assert.equal(afterOne.fullBody.assetId, "body-1");
  assert.equal(afterOne.expression.assetId, "expr-1");
  assert.equal(afterOne.wardrobe.assetId, "ward-1");
});

test("persisted production canonical slots win over seed character JSON after library hydrate", () => {
  for (const id of ["jasmine", "mikey", "marcus", "turner"]) {
    const seedCharacter = {
      id,
      refs: { identityFront: { key: "seed-default", name: "seed.jpg" } },
    };
    const saved = mergeSavedCharacters(
      [{ id, refs: { identityFront: { key: "library:approved", canonical: true, assetId: "approved" } } }],
      [seedCharacter],
    )[0];
    assert.equal(saved.refs.identityFront.assetId, "approved");
    const hydrated = syncCanonicalRefsFromLibrary(
      saved,
      [
        asset("seed-default", { isPrimary: true, category: "identity_anchor", sortOrder: 0, characterId: id }),
        asset("approved", { category: "identity_anchor", sortOrder: 1, characterId: id }),
      ],
      { identityFront: asset("approved", { characterId: id }) },
    );
    assert.equal(hydrated.identityFront.assetId, "approved");
    assert.notEqual(hydrated.identityFront.key, "seed-default");
  }
  assert.equal(CANONICAL_SLOT_KEYS.length, 5);
});
