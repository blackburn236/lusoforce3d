import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const PRODUCT_STORE = "lusoforce-products";
const IMAGE_STORE = "lusoforce-images";
const VIDEO_STORE = "lusoforce-videos";
const VIDEO_CATALOG_KEY = "videos-v1";
const CATALOG_KEY = "catalog-v1";
const COOKIE = "lf3d_admin";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
const allowedTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"],
  ["image/webp", "webp"], ["image/gif", "gif"]
]);

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});

function cookieValue(header, name) {
  const part = (header || "").split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function signature(value) {
  return createHmac("sha256", process.env.SESSION_SECRET || "").update(value).digest("base64url");
}
function validSession(request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return false;
  const token = cookieValue(request.headers.get("cookie"), COOKIE);
  const [stamp, supplied] = token.split(".");
  if (!stamp || !supplied || !/^\d+$/.test(stamp)) return false;
  const age = Date.now() - Number(stamp);
  if (age < 0 || age > 12 * 60 * 60 * 1000) return false;
  const expected = Buffer.from(signature(stamp));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function cookie(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; }
  catch { return false; }
}

const starterProducts = [
  { id: "starter-keychains", category: "porta", titlePt: "Porta-chaves personalizados", titleFr: "Porte-clés personnalisés", descriptionPt: "Nomes, iniciais, logótipos e pequenos presentes únicos.", descriptionFr: "Noms, initiales, logos et petits cadeaux uniques.", price: 4, imageKey: "", label: "CUSTOM MADE" },
  { id: "starter-cutters", category: "cozinha", titlePt: "Cortadores de bolachas", titleFr: "Emporte-pièces", descriptionPt: "Formas criativas para festas, datas especiais e momentos doces.", descriptionFr: "Des formes créatives pour fêtes, occasions spéciales et douceurs.", price: 3, imageKey: "", label: "KITCHEN" },
  { id: "starter-home", category: "casa", titlePt: "Decoração para casa", titleFr: "Décoration maison", descriptionPt: "Vasos, peças decorativas e objetos para personalizar o teu espaço.", descriptionFr: "Vases, objets décoratifs et pièces pour personnaliser ton intérieur.", price: 6, imageKey: "", label: "HOME DESIGN" },
  { id: "starter-accessories", category: "acessorios", titlePt: "Suportes e acessórios", titleFr: "Supports et accessoires", descriptionPt: "Organizadores, suportes para telemóvel e soluções práticas.", descriptionFr: "Organisateurs, supports de téléphone et solutions pratiques.", price: 5, imageKey: "", label: "DAILY USE" },
  { id: "starter-signs", category: "personalizados", titlePt: "Placas e logótipos", titleFr: "Plaques et logos", descriptionPt: "Identificação, sinalética e placas personalizadas em relevo.", descriptionFr: "Identification, signalétique et plaques personnalisées en relief.", price: 8, imageKey: "", label: "BRANDING" },
  { id: "starter-custom", category: "personalizados", titlePt: "Projeto 3D por medida", titleFr: "Projet 3D sur mesure", descriptionPt: "Tens uma ideia? Criamos uma peça à tua medida.", descriptionFr: "Tu as une idée ? Nous créons une pièce sur mesure.", price: 0, imageKey: "", label: "YOUR IDEA" }
];

async function readVideos() {
  return (await getStore(VIDEO_STORE).get(VIDEO_CATALOG_KEY, { type: "json", consistency: "strong" })) || [];
}
async function saveVideos(videos) {
  await getStore(VIDEO_STORE).setJSON(VIDEO_CATALOG_KEY, videos);
}
function validVideoUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:") return false;
    return ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "tiktok.com", "www.tiktok.com", "vm.tiktok.com"].includes(u.hostname);
  } catch { return false; }
}

async function readProducts() {
  const store = getStore(PRODUCT_STORE);
  return (await store.get(CATALOG_KEY, { type: "json", consistency: "strong" })) || starterProducts;
}
async function saveProducts(products) {
  await getStore(PRODUCT_STORE).setJSON(CATALOG_KEY, products);
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET" && url.searchParams.has("image")) {
      const key = url.searchParams.get("image") || "";
      if (!/^images\/[a-zA-Z0-9-]+\.(jpg|png|webp|gif)$/.test(key)) return new Response("Not found", { status: 404 });
      const image = await getStore(IMAGE_STORE).getWithMetadata(key, { type: "arrayBuffer" });
      if (!image) return new Response("Not found", { status: 404 });
      return new Response(image.data, { headers: {
        "content-type": image.metadata?.contentType || "application/octet-stream",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff"
      }});
    }

    if (method === "GET" && url.searchParams.has("video")) {
      const key = url.searchParams.get("video") || "";
      if (!/^videos\/[a-zA-Z0-9-]+\.mp4$/.test(key)) return new Response("Not found", { status: 404 });
      const video = await getStore(VIDEO_STORE).getWithMetadata(key, { type: "arrayBuffer" });
      if (!video) return new Response("Not found", { status: 404 });
      return new Response(video.data, { headers: {
        "content-type": "video/mp4",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
        "accept-ranges": "bytes"
      }});
    }

    if (method === "GET" && url.searchParams.has("videos")) {
      return json({ videos: await readVideos() }, 200, { "cache-control": "public, max-age=30, stale-while-revalidate=60" });
    }

    if (method === "GET" && url.searchParams.has("session")) {
      return json({ authenticated: validSession(request) });
    }

    if (method === "GET" && url.searchParams.has("products")) {
      return json({ products: await readProducts() }, 200, { "cache-control": "public, max-age=30, stale-while-revalidate=60" });
    }

    if (method !== "POST") return json({ error: "Método não permitido." }, 405);
    if (!sameOrigin(request)) return json({ error: "Pedido não autorizado." }, 403);

    const contentType = request.headers.get("content-type") || "";
    let action, payload;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      action = String(form.get("action") || "");
      payload = form;
    } else {
      payload = await request.json();
      action = String(payload.action || "");
    }

    if (action === "login") {
      const expectedPassword = process.env.ADMIN_PASSWORD || "";
      const secret = process.env.SESSION_SECRET || "";
      if (!expectedPassword || secret.length < 32) return json({ error: "Falta configurar ADMIN_PASSWORD e SESSION_SECRET na Netlify." }, 503);
      const given = Buffer.from(String(payload.password || ""));
      const expected = Buffer.from(expectedPassword);
      const ok = given.length === expected.length && timingSafeEqual(given, expected);
      if (!ok) return json({ error: "Palavra-passe incorreta." }, 401);
      const stamp = String(Date.now());
      const token = `${stamp}.${signature(stamp)}`;
      return json({ ok: true }, 200, { "set-cookie": cookie(token, 12 * 60 * 60) });
    }

    if (action === "logout") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
    if (!validSession(request)) return json({ error: "Sessão terminada. Inicia sessão novamente." }, 401);

    if (action === "upload") {
      const file = payload.get("file");
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Escolhe uma fotografia." }, 400);
      if (!allowedTypes.has(file.type)) return json({ error: "Formato não suportado. Usa JPG, PNG, WEBP ou GIF." }, 400);
      if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return json({ error: "A fotografia deve ter no máximo 4 MB." }, 413);
      const key = `images/${randomUUID()}.${allowedTypes.get(file.type)}`;
      await getStore(IMAGE_STORE).set(key, file, { metadata: { contentType: file.type } });
      return json({ imageKey: key, imageUrl: `/.netlify/functions/admin-api?image=${encodeURIComponent(key)}` });
    }

    if (action === "upload-video") {
      const file = payload.get("file");
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Escolhe um vídeo MP4." }, 400);
      if (file.type !== "video/mp4" && !String(file.name || "").toLowerCase().endsWith(".mp4")) return json({ error: "Só são aceites vídeos MP4." }, 400);
      if (file.size < 1 || file.size > MAX_VIDEO_BYTES) return json({ error: "O vídeo deve ter no máximo 5 MB nesta versão." }, 413);
      const key = `videos/${randomUUID()}.mp4`;
      await getStore(VIDEO_STORE).set(key, file, { metadata: { contentType: "video/mp4" } });
      const videos = await readVideos();
      const video = { id: randomUUID(), type: "mp4", title: String(payload.get("title") || "Vídeo LUSOFORCE 3D").trim().slice(0, 100), videoKey: key };
      videos.unshift(video);
      await saveVideos(videos);
      return json({ ok: true, video, videos });
    }

    if (action === "save-video") {
      const title = String(payload.title || "").trim().slice(0, 100);
      const videoUrl = String(payload.url || "").trim().slice(0, 500);
      if (!title) return json({ error: "Indica um título para o vídeo." }, 400);
      if (!validVideoUrl(videoUrl)) return json({ error: "Insere uma ligação HTTPS válida do YouTube ou TikTok." }, 400);
      const videos = await readVideos();
      const video = { id: randomUUID(), type: "link", title, url: videoUrl };
      videos.unshift(video);
      await saveVideos(videos);
      return json({ ok: true, video, videos });
    }

    if (action === "delete-video") {
      const id = String(payload.id || "");
      const videos = await readVideos();
      const video = videos.find(x => x.id === id);
      if (!video) return json({ error: "Vídeo não encontrado." }, 404);
      await saveVideos(videos.filter(x => x.id !== id));
      if (video.videoKey) await getStore(VIDEO_STORE).delete(video.videoKey);
      return json({ ok: true, videos: videos.filter(x => x.id !== id) });
    }

    if (action === "save") {
      const p = payload.product || {};
      const titlePt = String(p.titlePt || "").trim().slice(0, 100);
      const titleFr = String(p.titleFr || "").trim().slice(0, 100);
      if (!titlePt || !titleFr) return json({ error: "Preenche o nome em português e francês." }, 400);
      const products = await readProducts();
      const id = String(p.id || randomUUID()).slice(0, 80);
      const previous = products.find(x => x.id === id);
      const product = {
        id, category: String(p.category || "personalizados").slice(0, 40),
        titlePt, titleFr,
        descriptionPt: String(p.descriptionPt || "").trim().slice(0, 500),
        descriptionFr: String(p.descriptionFr || "").trim().slice(0, 500),
        price: Math.max(0, Math.min(100000, Number(p.price) || 0)),
        imageKey: String(p.imageKey || previous?.imageKey || "").slice(0, 120),
        label: String(p.label || "LUSOFORCE 3D").trim().slice(0, 40)
      };
      const index = products.findIndex(x => x.id === id);
      if (index >= 0) products[index] = product; else products.unshift(product);
      await saveProducts(products);
      if (previous?.imageKey && previous.imageKey !== product.imageKey) await getStore(IMAGE_STORE).delete(previous.imageKey);
      return json({ ok: true, product, products });
    }

    if (action === "delete") {
      const id = String(payload.id || "");
      const products = await readProducts();
      const product = products.find(x => x.id === id);
      if (!product) return json({ error: "Produto não encontrado." }, 404);
      await saveProducts(products.filter(x => x.id !== id));
      if (product.imageKey) await getStore(IMAGE_STORE).delete(product.imageKey);
      return json({ ok: true, products: products.filter(x => x.id !== id) });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("LUSOFORCE admin API error:", error);
    return json({ error: "Ocorreu um erro no servidor. Verifica a configuração da Netlify e tenta novamente." }, 500);
  }
};
