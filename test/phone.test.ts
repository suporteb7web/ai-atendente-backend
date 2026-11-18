import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/modules/conversations/phone.js";

describe("normalizePhone", () => {
  it("remove o sufixo de JID", () => {
    expect(normalizePhone("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("remove máscara e o sinal de mais", () => {
    expect(normalizePhone("+55 (11) 99999-9999")).toBe("5511999999999");
  });

  it("insere o nono dígito em celular brasileiro de 12 dígitos", () => {
    expect(normalizePhone("551188887777")).toBe("5511988887777");
    expect(normalizePhone("551188887777@s.whatsapp.net")).toBe("5511988887777");
  });

  it("mantém o número que já tem 13 dígitos", () => {
    expect(normalizePhone("5511988887777")).toBe("5511988887777");
  });

  it("mantém comprimentos que não são o celular brasileiro antigo", () => {
    expect(normalizePhone("14155552671")).toBe("14155552671");
    expect(normalizePhone("11988887777")).toBe("11988887777");
  });
});
