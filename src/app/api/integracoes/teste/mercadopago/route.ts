import { testMercadoPagoIntegration } from "@/services/integration-connection-test";

export async function POST() {
  return testMercadoPagoIntegration();
}
