import { NextResponse } from "next/server";
import { getResearchState, resetResearch } from "@/app/lib/research-state";

export async function GET() {
  return NextResponse.json(getResearchState());
}

export async function POST() {
  resetResearch();
  return NextResponse.json({ status: "idle" });
}
