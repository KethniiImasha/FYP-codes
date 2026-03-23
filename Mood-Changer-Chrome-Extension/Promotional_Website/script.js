// Simple interaction script
document.addEventListener('DOMContentLoaded', () => {
    const mockup = document.querySelector('.extension-mockup');
    
    // Add subtle mouse tracking effect to the hero mockup
    document.addEventListener('mousemove', (e) => {
        if (!mockup || window.innerWidth <= 768) return;
        
        const xAxis = (window.innerWidth / 2 - e.pageX) / 50;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 50;
        
        mockup.style.transform = `rotateY(${xAxis - 10}deg) rotateX(${yAxis + 10}deg)`;
    });

    // Reset transform on mouse leave
    document.addEventListener('mouseleave', () => {
        if (!mockup || window.innerWidth <= 768) return;
        mockup.style.transform = `rotateY(-10deg) rotateX(10deg)`;
    });
});
