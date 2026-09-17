/**
 * responsive.js — Gerenciamento universal de responsividade para TermoEP
 * Suporta Telas Pequenas (Mobile), Tablets, Laptops e Telas Ultrawide
 */
(function () {
  function initResponsive() {
    initMobileSidebar();
    initResponsiveTables();
  }

  function initMobileSidebar() {
    const pageWrapper = document.querySelector('.page-wrapper');
    const sidebar = document.querySelector('.sidebar');
    if (!pageWrapper || !sidebar) return;

    if (document.querySelector('.mobile-topbar')) return;

    // Obtém iniciais do usuário logado se disponível
    const initialsElem = document.getElementById('user-initials');
    const initials = initialsElem ? initialsElem.textContent.trim() : 'U';

    // Cria Topbar móvel
    const mobileTopBar = document.createElement('div');
    mobileTopBar.className = 'mobile-topbar';
    mobileTopBar.innerHTML = `
      <button class="mobile-menu-btn" id="btn-toggle-sidebar" aria-label="Abrir Menu">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div class="mobile-brand">
        <img src="/termoep_logo.jpg" alt="TermoEP" class="mobile-brand-logo">
        <div class="mobile-brand-text"><span style="color:#00D4FF">Termo</span><span style="color:white;font-weight:900">EP</span></div>
      </div>
      <div class="mobile-user-avatar" id="mobile-user-initials">${initials}</div>
    `;

    // Cria Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';

    // Botão de fechar dentro do menu lateral
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sidebar-close-btn';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    closeBtn.setAttribute('aria-label', 'Fechar Menu');

    // Insere o botão de fechar no topo da sidebar
    const sidebarLogo = sidebar.querySelector('.sidebar-logo');
    if (sidebarLogo) {
      sidebarLogo.style.position = 'relative';
      sidebarLogo.appendChild(closeBtn);
    } else {
      sidebar.prepend(closeBtn);
    }

    document.body.prepend(mobileTopBar);
    document.body.appendChild(backdrop);

    function openNav() {
      sidebar.classList.add('open');
      backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeNav() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
      document.body.style.overflow = '';
    }

    mobileTopBar.querySelector('#btn-toggle-sidebar').addEventListener('click', openNav);
    closeBtn.addEventListener('click', closeNav);
    backdrop.addEventListener('click', closeNav);

    sidebar.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 992) closeNav();
      });
    });

    // Atualiza iniciais dinamicamente quando a tela carregar dados
    const observer = new MutationObserver(() => {
      const srcInit = document.getElementById('user-initials');
      const targetInit = document.getElementById('mobile-user-initials');
      if (srcInit && targetInit && srcInit.textContent.trim()) {
        targetInit.textContent = srcInit.textContent.trim();
      }
    });

    if (initialsElem) {
      observer.observe(initialsElem, { childList: true, characterData: true, subtree: true });
    }
  }

  function initResponsiveTables() {
    document.querySelectorAll('table').forEach(table => {
      const parent = table.parentElement;
      if (!parent.classList.contains('table-responsive') && !parent.classList.contains('table-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-responsive';
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });
  }

  /**
   * Copiador Universal de Texto com suporte total a HTTP, HTTPS e navegadores móveis/desktop
   */
  window.copiarTextoUniversal = function (texto, btnElement) {
    if (!texto) return;

    function onSucesso() {
      if (typeof toast === 'function') {
        toast('Link copiado para a área de transferência!', 'success');
      }
      if (btnElement) {
        const originalText = btnElement.textContent;
        btnElement.textContent = '✅ Copiado!';
        btnElement.style.background = 'var(--success)';
        btnElement.style.borderColor = 'var(--success)';
        setTimeout(() => {
          btnElement.textContent = originalText;
          btnElement.style.background = '';
          btnElement.style.borderColor = '';
        }, 2500);
      }
    }

    // Tenta API moderna se estiver em ambiente seguro
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto)
        .then(onSucesso)
        .catch(() => execCopyFallback(texto, onSucesso));
    } else {
      execCopyFallback(texto, onSucesso);
    }
  };

  function execCopyFallback(texto, onSucesso) {
    const textArea = document.createElement('textarea');
    textArea.value = texto;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const ok = document.execCommand('copy');
      if (ok) {
        onSucesso();
      } else {
        prompt('Copie o link abaixo manualmente (Ctrl+C ou pressione para copiar):', texto);
      }
    } catch (e) {
      prompt('Copie o link abaixo manualmente (Ctrl+C ou pressione para copiar):', texto);
    } finally {
      document.body.removeChild(textArea);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initResponsive);
  } else {
    initResponsive();
  }
})();
