(() => {
  "use strict";

  // The Blocks category uses 16px BlockSprite thumbnails. Prefer that
  // isometric icon; keep the existing Mojang texture as a per-block fallback.
  const SPRITE_ROOT = "https://minecraft.wiki/images/BlockSprite_";
  const rows = document.getElementById("blockRows");
  const savedList = document.getElementById("savedBlockList");
  const selectedThumb = document.getElementById("selectedThumb");
  if (!rows) return;

  const aliases = {
    grass: ["grass-block"],
    bed: ["red-bed"],
    tallgrass: ["tall-grass"],
    snow_layer: ["snow"],
    diamond_block: ["block-of-diamond"],
    emerald_block: ["block-of-emerald"],
    gold_block: ["block-of-gold"],
    iron_block: ["block-of-iron"],
    coal_block: ["block-of-coal"],
    redstone_block: ["block-of-redstone"],
    lapis_block: ["block-of-lapis-lazuli"],
    netherite_block: ["block-of-netherite"],
    quartz_block: ["block-of-quartz"],
    raw_iron_block: ["block-of-raw-iron"],
    raw_gold_block: ["block-of-raw-gold"],
    raw_copper_block: ["block-of-raw-copper"],
    amethyst_block: ["block-of-amethyst"],
    bamboo_block: ["block-of-bamboo"],
    copper_block: ["block-of-copper"],
    wooden_planks: ["oak-planks"],
    wooden_door: ["oak-door"],
    wooden_slab: ["oak-slab"],
    wooden_double_slab: ["oak-slab"],
    wooden_stairs: ["oak-stairs"],
    wooden_pressure_plate: ["oak-pressure-plate"],
    standing_sign: ["oak-sign"],
    wall_sign: ["oak-wall-sign"],
    water: ["flowing-water"],
    still_water: ["flowing-water"],
    stonebrick: ["stone-bricks"],
    web: ["cobweb"],
    lit_pumpkin: ["jack-o-lantern"],
    unlit_redstone_torch: ["redstone-torch"],
    redstone_torch_off: ["redstone-torch"],
    redstone_torch_on: ["redstone-torch"],
    double_stone_slab: ["double-stone-slab"],
    stone_slab: ["stone-slab"],
    brick_block: ["bricks"],
    darkoak_standing_sign: ["dark-oak-sign"],
    darkoak_wall_sign: ["dark-oak-wall-sign"],
    wooden_button: ["oak-button"]
  };

  const CROSS_MODEL_IDS = new Set([
    "amethyst_cluster",
    "small_amethyst_bud",
    "medium_amethyst_bud",
    "large_amethyst_bud",
    "amethyst_bud"
  ]);

  const resolved = new Map();

  function cleanId(value) {
    return String(value || "").replace(/^minecraft:/i, "").toLowerCase();
  }

  function candidateSlugs(id) {
    const candidates = [...(aliases[id] || [])];
    if (id.endsWith("_standing_sign")) {
      candidates.push(id.replace(/_standing_sign$/, "-sign"));
    }
    if (id.endsWith("_wood")) {
      candidates.push(id.replace(/_wood$/, "-log"));
    }
    candidates.push(id.replace(/_/g, "-"));
    return [...new Set(candidates.filter(Boolean))];
  }

  function spriteUrl(slug) {
    return SPRITE_ROOT + encodeURIComponent(slug) + ".png";
  }

  function rememberFallback(img) {
    if (!img.dataset.mojangFallback) {
      img.dataset.mojangFallback = img.getAttribute("src") || "";
    }
    return img.dataset.mojangFallback;
  }

  function amethystStageClass(id) {
    if (id === "small_amethyst_bud") return "is-small-amethyst-bud";
    if (id === "medium_amethyst_bud") return "is-medium-amethyst-bud";
    if (id === "large_amethyst_bud") return "is-large-amethyst-bud";
    return "is-amethyst-cluster";
  }

  function makeCrossIcon(id, textureUrl) {
    if (!CROSS_MODEL_IDS.has(id) || !textureUrl) return null;
    const icon = document.createElement("span");
    icon.className = "block-cross-icon " + amethystStageClass(id);
    icon.dataset.crossBlockId = id;
    icon.dataset.crossTextureUrl = textureUrl;
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", "Cross model icon for minecraft:" + id);
    icon.title = "Cross model · minecraft:" + id;
    icon.style.setProperty("--cross-icon-texture", 'url("' + textureUrl.replace(/"/g, "%22") + '")');
    return icon;
  }

  function replaceWithCrossIcon(element, id, textureUrl) {
    const icon = makeCrossIcon(id, textureUrl);
    if (!icon) return false;
    element.replaceWith(icon);
    return true;
  }

  function restoreFallback(img, fallback) {
    img.onload = null;
    img.onerror = null;
    img.classList.remove("wiki-block-sprite");
    img.dataset.wikiIconState = "fallback";
    if (fallback && img.getAttribute("src") !== fallback) img.setAttribute("src", fallback);
  }

  function applySprite(img, rawId) {
    if (!img) return;
    const id = cleanId(rawId);
    if (!id || rawId.includes(":") && !String(rawId).startsWith("minecraft:")) return;

    const fallback = rememberFallback(img);
    if (replaceWithCrossIcon(img, id, fallback)) return;
    if (img.dataset.wikiBlockId === id) {
      if (img.dataset.wikiIconState === "wiki" || img.dataset.wikiIconState === "fallback" ||
          img.dataset.wikiIconState === "loading") return;
    }

    img.dataset.wikiBlockId = id;
    const known = resolved.get(id);
    if (known === null) {
      restoreFallback(img, fallback);
      return;
    }
    if (known) {
      img.onload = () => {
        img.dataset.wikiIconState = "wiki";
        img.classList.add("wiki-block-sprite");
      };
      img.onerror = () => {
        resolved.delete(id);
        img.dataset.wikiIconState = "";
        applySprite(img, id);
      };
      img.setAttribute("src", spriteUrl(known));
      return;
    }

    const candidates = candidateSlugs(id);
    let index = 0;
    img.classList.remove("wiki-block-sprite");
    img.dataset.wikiIconState = "loading";

    const tryNext = () => {
      if (index >= candidates.length) {
        resolved.set(id, null);
        restoreFallback(img, fallback);
        return;
      }
      const slug = candidates[index++];
      img.dataset.wikiIconSlug = slug;
      img.src = spriteUrl(slug);
    };

    img.onload = () => {
      if (img.naturalWidth > 0) {
        const slug = img.dataset.wikiIconSlug;
        resolved.set(id, slug);
        img.dataset.wikiIconState = "wiki";
        img.classList.add("wiki-block-sprite");
        img.title = "Minecraft Wiki block sprite · minecraft:" + id;
        return;
      }
      tryNext();
    };
    img.onerror = tryNext;
    tryNext();
  }

  function applySpriteToFallback(element, rawId) {
    const id = cleanId(rawId);
    if (!id || element.dataset.wikiBlockId === id) return;
    element.dataset.wikiBlockId = id;
    element.dataset.wikiIconState = "loading";
    const known = resolved.get(id);
    if (known === null) {
      element.dataset.wikiIconState = "fallback";
      return;
    }
    const candidates = known ? [known] : candidateSlugs(id);
    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        resolved.set(id, null);
        element.dataset.wikiIconState = "fallback";
        return;
      }
      const slug = candidates[index++];
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth <= 0) return tryNext();
        if (!element.isConnected || element.dataset.wikiBlockId !== id) return;
        resolved.set(id, slug);
        const image = document.createElement("img");
        image.className = "block-texture wiki-block-sprite";
        image.loading = "lazy";
        image.decoding = "async";
        image.width = 25;
        image.height = 25;
        image.alt = "";
        image.src = spriteUrl(slug);
        image.title = "Minecraft Wiki block sprite · minecraft:" + id;
        image.dataset.wikiBlockId = id;
        image.dataset.wikiIconSlug = slug;
        image.dataset.wikiIconState = "wiki";
        element.replaceWith(image);
      };
      probe.onerror = tryNext;
      probe.src = spriteUrl(slug);
    };
    tryNext();
  }

  function updateBlockRows() {
    rows.querySelectorAll(".catalog-row").forEach(row => {
      const id = row.dataset.id;
      const image = row.querySelector("img.block-texture");
      const fallback = row.querySelector(".block-texture-fallback");
      if (image) applySprite(image, id);
      else if (fallback) applySpriteToFallback(fallback, id);
    });
  }

  function updateSavedPalette() {
    if (!savedList) return;
    savedList.querySelectorAll(".saved-palette-choice").forEach(choice => {
      const id = choice.dataset.savedBlockId;
      const image = choice.querySelector("img");
      if (image) applySprite(image, id);
    });
  }

  function updateSelectedThumb() {
    if (!selectedThumb) return;
    const selectedRow = rows.querySelector(".catalog-row.is-selected");
    const id = cleanId(selectedRow?.dataset.id);
    if (!id) return;

    if (CROSS_MODEL_IDS.has(id)) {
      if (selectedThumb.dataset.wikiBlockId === id && selectedThumb.dataset.wikiIconState === "cross") return;
      const crossIcon = selectedRow.querySelector(".block-cross-icon");
      const image = selectedRow.querySelector("img.block-texture");
      const textureUrl = crossIcon?.dataset.crossTextureUrl ||
        image?.dataset.mojangFallback || image?.getAttribute("src") || "";
      if (textureUrl) {
        selectedThumb.classList.remove(
          "is-wiki-sprite",
          "is-small-amethyst-bud",
          "is-medium-amethyst-bud",
          "is-large-amethyst-bud",
          "is-amethyst-cluster"
        );
        selectedThumb.classList.add("is-cross-model", "has-image", amethystStageClass(id));
        selectedThumb.style.backgroundImage = "none";
        selectedThumb.style.backgroundColor = "#282535";
        selectedThumb.style.backgroundBlendMode = "normal";
        selectedThumb.style.setProperty("--cross-icon-texture", 'url("' + textureUrl.replace(/"/g, "%22") + '")');
        selectedThumb.dataset.wikiBlockId = id;
        selectedThumb.dataset.wikiIconState = "cross";
        return;
      }
    }

    selectedThumb.classList.remove("is-cross-model", "is-small-amethyst-bud", "is-medium-amethyst-bud", "is-large-amethyst-bud", "is-amethyst-cluster");
    selectedThumb.style.removeProperty("--cross-icon-texture");

    const current = selectedThumb.style.backgroundImage || "";
    if (selectedThumb.dataset.wikiBlockId === id &&
        (selectedThumb.dataset.wikiIconState === "loading" ||
         selectedThumb.dataset.wikiIconState === "fallback" ||
         current.includes("minecraft.wiki/images/BlockSprite_"))) return;

    const image = selectedRow.querySelector("img.block-texture");
    const fallback = image?.dataset.mojangFallback || image?.getAttribute("src") || "";
    const known = resolved.get(id);
    const candidates = known ? [known] : candidateSlugs(id);
    let index = 0;

    const tryNext = () => {
      if (index >= candidates.length) {
        selectedThumb.classList.remove("is-wiki-sprite");
        if (fallback) selectedThumb.style.backgroundImage = 'url("' + fallback + '")';
        selectedThumb.dataset.wikiBlockId = id;
        selectedThumb.dataset.wikiIconState = "fallback";
        return;
      }
      const slug = candidates[index++];
      const imageProbe = new Image();
      imageProbe.onload = () => {
        if (imageProbe.naturalWidth <= 0) return tryNext();
        const url = spriteUrl(slug);
        resolved.set(id, slug);
        selectedThumb.style.backgroundImage = 'url("' + url + '")';
        selectedThumb.classList.add("is-wiki-sprite");
        selectedThumb.dataset.wikiBlockId = id;
        selectedThumb.dataset.wikiIconState = "wiki";
      };
      imageProbe.onerror = tryNext;
      imageProbe.src = spriteUrl(slug);
    };

    selectedThumb.dataset.wikiBlockId = id;
    selectedThumb.dataset.wikiIconState = "loading";
    tryNext();
  }

  function refresh() {
    updateBlockRows();
    updateSavedPalette();
    updateSelectedThumb();
  }

  const rowObserver = new MutationObserver(refresh);
  rowObserver.observe(rows, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  if (savedList) {
    const paletteObserver = new MutationObserver(updateSavedPalette);
    paletteObserver.observe(savedList, { childList: true, subtree: true });
  }

  if (selectedThumb) {
    const thumbObserver = new MutationObserver(() => {
      const current = selectedThumb.style.backgroundImage || "";
      if (!current.includes("minecraft.wiki/images/BlockSprite_")) updateSelectedThumb();
    });
    thumbObserver.observe(selectedThumb, { attributes: true, attributeFilter: ["style"] });
  }

  refresh();
})();