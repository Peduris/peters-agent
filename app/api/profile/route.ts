import { getProfile, ensureProfile, updateProfile } from "@/lib/db/queries";
import { DEFAULT_PUBLIC_BIO } from "@/lib/ai/copy";
import { hasNeon, missingServices } from "@/lib/env";

export async function GET() {
  const profile = hasNeon() ? await getProfile() : null;
  return Response.json({
    profile: profile ?? {
      id: "peter",
      full_name: "Peter",
      headline: "Builder & strategist",
      public_bio: DEFAULT_PUBLIC_BIO,
      structured: {},
      onboarding_state: "new",
      onboarding_questions: [],
      onboarding_answers: [],
    },
    neon: hasNeon(),
    missing: missingServices(),
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (!hasNeon()) {
    return Response.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }
  await ensureProfile();
  const updated = await updateProfile({
    public_bio: typeof body.public_bio === "string" ? body.public_bio : undefined,
    headline: typeof body.headline === "string" ? body.headline : undefined,
    full_name: typeof body.full_name === "string" ? body.full_name : undefined,
  });
  return Response.json({ profile: updated });
}
