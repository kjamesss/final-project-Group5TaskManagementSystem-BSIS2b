// Content stays visible if JavaScript, animation, or IntersectionObserver is unavailable.
if ('IntersectionObserver' in window && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('reveal');
            observer.unobserve(entry.target);
        }
    }, { threshold: 0.08 });
    document.querySelectorAll('.hero-copy, .workspace-links, main .card').forEach(section => observer.observe(section));
}
