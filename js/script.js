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
});
