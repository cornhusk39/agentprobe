// Downloads the authored suite as a JSON file. A route handler rather than a
// server action because a file download needs to set response headers.

import { exportSuiteJson, activeSuite } from "../../../../lib/suite";

export const dynamic = "force-dynamic";

export function GET() {
  const body = exportSuiteJson();
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${activeSuite()}.suite.json"`,
    },
  });
}
