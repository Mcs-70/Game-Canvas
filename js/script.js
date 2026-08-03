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

  // Language switch: swaps every [data-en][data-ar] element's text (and
  // meta content) between English and Arabic, flips dir for RTL layout,
  // and remembers the choice in localStorage so it persists across pages.
  const LANG_STORAGE_KEY = "gc-lang";
  const translatable = document.querySelectorAll("[data-en][data-ar]");
  const langToggle = document.getElementById("lang-toggle");
  const langToggleText = langToggle ? langToggle.querySelector(".lang-toggle-text") : null;

  function applyLanguage(lang) {
    document.documentElement.lang = lang === "ar" ? "ar" : "en";
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    translatable.forEach((el) => {
      const text = lang === "ar" ? el.dataset.ar : el.dataset.en;
      if (text == null) return;
      if (el.tagName === "META") {
        el.setAttribute("content", text);
      } else {
        el.textContent = text;
      }
    });

    if (langToggleText) {
      langToggleText.textContent = lang === "ar" ? "English" : "العربية";
    }
    if (langToggle) {
      langToggle.setAttribute("aria-label", lang === "ar" ? "Switch to English" : "التبديل إلى العربية");
    }
  }

  if (langToggle) {
    langToggle.addEventListener("click", () => {
      const next = document.documentElement.lang === "ar" ? "en" : "ar";
      localStorage.setItem(LANG_STORAGE_KEY, next);
      applyLanguage(next);
    });
  }

  applyLanguage(localStorage.getItem(LANG_STORAGE_KEY) === "ar" ? "ar" : "en");
});
