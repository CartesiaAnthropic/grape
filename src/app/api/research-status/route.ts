import { NextResponse } from "next/server";
import { getResearchState } from "@/app/lib/research-state";

export async function GET() {
  return NextResponse.json(getResearchState());
}
