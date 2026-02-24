import { GET as getTableComponent } from "../table/route";

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  incomingUrl.searchParams.set("component_code", "conditional_bar");

  const forwarded = new Request(incomingUrl.toString(), {
    method: request.method,
    headers: request.headers,
  });

  return getTableComponent(forwarded);
}

