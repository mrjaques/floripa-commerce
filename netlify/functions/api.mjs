import { getStore } from "@netlify/blobs";

const J = (d, s = 200, h = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", ...h } });

export default async (req) => {
  const store = getStore("loja");
  const path = new URL(req.url).pathname.replace(/^\/api\//, "").split("/");
  const list = async () => (await store.get("products", { type: "json" })) || [];
  const save = (l) => store.setJSON("products", l);
  const pw = Netlify.env.get("ADMIN_PASSWORD");
  const isAdmin = !!pw && req.headers.get("x-admin-password") === pw;

  // Público: lista de produtos e imagens
  if (req.method === "GET" && path[0] === "products") return J(await list(), 200, { "cache-control": "no-cache" });
  if (req.method === "GET" && path[0] === "img") {
    const b64 = await store.get("img-" + (path[1] || "").replace(/[^\w-]/g, ""));
    if (!b64) return new Response("", { status: 404 });
    return new Response(Buffer.from(b64, "base64"), {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  // Admin: exige senha
  if (!isAdmin) return J({ error: "Senha incorreta" }, 401);
  if (path[0] === "login") return J({ ok: true });

  if (req.method === "POST" && path[0] === "products") {
    let b;
    try { b = await req.json(); } catch { return J({ error: "Dados inválidos" }, 400); }
    const name = String(b.name || "").trim().slice(0, 300);
    const link = String(b.link || "").trim();
    const price = Number(b.price);
    if (!name || !/^https?:\/\//i.test(link) || !(price >= 0))
      return J({ error: "Preencha descrição, preço e um link válido (https://...)" }, 400);

    const l = await list();
    const prev = b.id ? l.find((p) => p.id === b.id) : null;
    let image = prev?.image || "";
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(b.imageData || "");
    if (m) {
      if (m[1].length > 4_000_000) return J({ error: "Imagem muito grande" }, 413);
      const imgId = crypto.randomUUID();
      await store.set("img-" + imgId, m[1]);
      if (prev?.image) await store.delete("img-" + prev.image.split("/").pop());
      image = "/api/img/" + imgId;
    }
    const item = {
      id: prev?.id || crypto.randomUUID(),
      name,
      category: String(b.category || "").trim().slice(0, 40) || "Geral",
      price,
      old: Number(b.old) || 0,
      link,
      image,
    };
    await save(prev ? l.map((p) => (p.id === prev.id ? item : p)) : [item, ...l]);
    return J(item);
  }

  if (req.method === "DELETE" && path[0] === "products" && path[1]) {
    const l = await list();
    const p = l.find((x) => x.id === path[1]);
    if (p?.image) await store.delete("img-" + p.image.split("/").pop());
    await save(l.filter((x) => x.id !== path[1]));
    return J({ ok: true });
  }
  return J({ error: "Não encontrado" }, 404);
};

export const config = { path: "/api/*" };
