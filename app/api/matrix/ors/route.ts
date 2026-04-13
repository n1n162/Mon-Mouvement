import { NextRequest, NextResponse } from "next/server";

const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(ORS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ORS_API_KEY!,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: "ORS error", detail: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 }
    );
  }
}