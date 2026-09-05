import { testSavedIntegration } from "@/services/integration-connection-test";

export async function POST() {
  return testSavedIntegration("dslite");
}
