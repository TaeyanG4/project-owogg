import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  UpdateNicknameRequestSchema,
  UpdateCountryRequestSchema,
  UpdateAvatarPreferenceRequestSchema,
  UpdateProfilePresentationRequestSchema,
} from "@owogg/contracts";
import { COUNTRY_OPTIONS, countryLabel } from "../lib/countries.js";

describe("Profile settings (nickname/country) client contracts", () => {
  it("UpdateNicknameRequestSchema accepts a trimmed non-empty nickname", () => {
    const parsed = UpdateNicknameRequestSchema.safeParse({ nickname: "Taeyang" });
    assert.equal(parsed.success, true);
  });

  it("UpdateNicknameRequestSchema rejects an empty nickname", () => {
    const parsed = UpdateNicknameRequestSchema.safeParse({ nickname: "" });
    assert.equal(parsed.success, false);
  });

  it("UpdateCountryRequestSchema accepts a country code or null (unset)", () => {
    assert.equal(UpdateCountryRequestSchema.safeParse({ country: "KR" }).success, true);
    assert.equal(UpdateCountryRequestSchema.safeParse({ country: null }).success, true);
  });

  it("UpdateAvatarPreferenceRequestSchema accepts only supported OAuth providers", () => {
    assert.equal(
      UpdateAvatarPreferenceRequestSchema.safeParse({ provider: "google" }).success,
      true,
    );
    assert.equal(
      UpdateAvatarPreferenceRequestSchema.safeParse({ provider: "discord" }).success,
      true,
    );
    assert.equal(UpdateAvatarPreferenceRequestSchema.safeParse({ provider: "url" }).success, false);
  });

  it("profile presentation accepts presets and caps the CommonMark biography", () => {
    assert.equal(
      UpdateProfilePresentationRequestSchema.safeParse({
        banner: "SUNSET",
        bioMarkdown: "## 소개",
      }).success,
      true,
    );
    assert.equal(
      UpdateProfilePresentationRequestSchema.safeParse({
        banner: "CUSTOM",
        bioMarkdown: "not allowed",
      }).success,
      false,
    );
    assert.equal(
      UpdateProfilePresentationRequestSchema.safeParse({
        banner: "AURORA",
        bioMarkdown: "x".repeat(2001),
      }).success,
      false,
    );
  });

  it("profile layout uses compact identity, new banner artwork, left contributions, and right XP", () => {
    const profile = readFileSync(
      fileURLToPath(new URL("../routes/userProfile.tsx", import.meta.url)),
      "utf8",
    );
    const dictionary = readFileSync(
      fileURLToPath(new URL("../features/i18n/dictionary.ts", import.meta.url)),
      "utf8",
    );

    assert.match(profile, /max-w-\[1280px\]/);
    assert.match(profile, /h-52 overflow-hidden bg-slate-950 sm:h-60 lg:h-72/);
    assert.match(profile, /h-24 w-24.*sm:h-28 sm:w-28 lg:h-32 lg:w-32/);
    assert.match(profile, /PROFILE_BANNER_ART/);
    assert.match(profile, /data-profile-experience/);
    assert.equal(profile.match(/dict\.userProfile\.contributionsTitle/g)?.length, 1);
    assert.ok(
      profile.indexOf("dict.userProfile.contributionsTitle") < profile.indexOf("<main"),
      "contribution metrics belong in the left profile information column",
    );
    assert.ok(
      profile.indexOf("data-profile-experience") > profile.indexOf("<main"),
      "experience belongs in the right profile content column",
    );
    assert.match(dictionary, /bannerNovaGlass: "노바 글래스"/);
    assert.match(dictionary, /bannerSakuraNight: "사쿠라 나이트"/);
    assert.doesNotMatch(dictionary, /bannerAurora:/);
  });

  it("COUNTRY_OPTIONS entries are unique two-letter codes with a Korean label", () => {
    const codes = COUNTRY_OPTIONS.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length, "country codes must be unique");
    for (const option of COUNTRY_OPTIONS) {
      assert.match(option.code, /^[A-Z]{2}$/);
      assert.ok(option.labelKo.length > 0);
    }
  });

  it("countryLabel resolves a known code, falls back to the raw code, and labels null as unset", () => {
    assert.equal(countryLabel("KR"), "대한민국");
    assert.equal(countryLabel("ZZ"), "ZZ");
    assert.equal(countryLabel(null), "설정 안 함");
    assert.equal(countryLabel(undefined), "설정 안 함");
  });
});
