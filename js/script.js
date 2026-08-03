// Game Canvas — nav interactions: mobile menu toggle, close-on-link-click,
// and scroll-spy active-link highlighting.

document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.getElementById("nav-toggle");
  const navHamburger = document.getElementById("nav-hamburger");
  const navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main .section, .hero");

  // Keep aria-expanded in sync with the checkbox so screen readers
  // announce open/closed state correctly.
  if (navToggle && navHamburger) {
    navToggle.addEventListener("change", () => {
      navHamburger.setAttribute("aria-expanded", navToggle.checked ? "true" : "false");
    });
  }

  // Close the mobile menu after a link is tapped, since the checkbox
  // otherwise stays checked after the page scrolls.
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (navToggle && navToggle.checked) {
        navToggle.checked = false;
        navHamburger.setAttribute("aria-expanded", "false");
      }
    });
  });

  // Scroll-spy: highlight the nav link for whichever section is
  // currently in view, using IntersectionObserver instead of scroll
  // listeners to avoid layout thrash.
  if (sections.length && navLinks.length) {
    const linksById = new Map();
    navLinks.forEach((link) => {
      const id = link.getAttribute("href");
      if (id && id.startsWith("#")) {
        linksById.set(id.slice(1), link);
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = linksById.get(entry.target.id);
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((l) => l.classList.remove("active"));
            link.classList.add("active");
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((section) => {
      if (section.id) observer.observe(section);
    });
  }

  // ===== Language switch: swaps data-en/data-ar content, flips dir, and
  // remembers the choice in localStorage (read early in <head> to avoid
  // a flash of the wrong language/direction on repeat visits). =====
  const STORAGE_KEY = "gc-lang";
  const langToggle = document.getElementById("lang-toggle");
  const translatableText = document.querySelectorAll("[data-en][data-ar]");
  const translatableLabels = document.querySelectorAll("[data-en-label][data-ar-label]");
  const translatableContent = document.querySelectorAll("[data-en-content][data-ar-content]");

  function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    translatableText.forEach((el) => {
      el.textContent = lang === "ar" ? el.dataset.ar : el.dataset.en;
    });
    translatableLabels.forEach((el) => {
      el.setAttribute("aria-label", lang === "ar" ? el.dataset.arLabel : el.dataset.enLabel);
    });
    translatableContent.forEach((el) => {
      el.setAttribute("content", lang === "ar" ? el.dataset.arContent : el.dataset.enContent);
    });

    if (langToggle) {
      const nextLang = lang === "ar" ? "en" : "ar";
      langToggle.textContent = nextLang === "ar" ? "العربية" : "English";
      langToggle.setAttribute("lang", nextLang);
      langToggle.setAttribute(
        "aria-label",
        nextLang === "ar" ? "التبديل إلى العربية" : "Switch to English"
      );
    }

    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
  }

  if (langToggle) {
    langToggle.addEventListener("click", () => {
      const current = document.documentElement.lang === "ar" ? "ar" : "en";
      applyLanguage(current === "ar" ? "en" : "ar");
    });
  }

  let savedLang = "en";
  try {
    savedLang = localStorage.getItem(STORAGE_KEY) === "ar" ? "ar" : "en";
  } catch (e) {}
  applyLanguage(savedLang);
});
