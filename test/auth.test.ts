import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("auth", () => {
  it("recusa pedido sem header", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/conversations");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("recusa token errado", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/conversations").set("Authorization", "Bearer outro");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("aceita o token certo", async () => {
    const { app, token } = createTestApp();
    const response = await request(app).get("/conversations").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], nextCursor: null });
  });
});
