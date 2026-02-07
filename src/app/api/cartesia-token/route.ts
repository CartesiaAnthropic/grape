import { CartesiaClient } from "@cartesia/cartesia-js";
import { NextResponse } from "next/server";

const client = new CartesiaClient({
  apiKey: process.env.CARTESIA_API_KEY,
});

export async function POST() {
  try {
    const token = await client.auth.accessToken({
      grants: { stt: true, tts: true },
      expiresIn: 300,
    });
    return NextResponse.json({ access_token: token.token });
  } catch (error) {
    console.error("Failed to generate Cartesia access token:", error);
    return NextResponse.json(
      { error: "Failed to generate access token" },
      { status: 500 }
    );
  }
}
