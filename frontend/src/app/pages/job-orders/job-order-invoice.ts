import { JobOrder } from '../../shared/services/job-orders.service';

export function generateJobOrderInvoiceHtml(jo: JobOrder, options?: { partsSuppliedBy?: string; warranty?: string; releasedBy?: string }): string {
  const services = (jo.supplies ?? []).filter((s: any) => s.supplyType === 'service' || s.serviceName);
  const parts = (jo.supplies ?? []).filter((s: any) => s.supplyType === 'part' || (!s.serviceName && s.description));

  // Services as comma-separated string
  const servicesList = services.map((s: any) => s.serviceName || s.description || '').filter(Boolean).join(', ');

  const partsTotal = parts.reduce((sum: number, p: any) => sum + ((Number(p.billingPrice) || 0) * (Number(p.quantity) || 1)), 0);
  const laborFee = Number(jo.laborFee) || 0;
  const discount = Number(jo.discount) || 0;
  const grandTotal = Number(jo.totalAmount) || (partsTotal + laborFee - discount);

  const joDate = jo.createdAt ? new Date(jo.createdAt).toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '';
  const joNumber = jo.joNumber?.replace(/\D/g, '') || jo.joNumber || '';

  const partsSuppliedBy = options?.partsSuppliedBy ?? (jo as any).partsSuppliedBy ?? 'car_expert';
  const warranty = options?.warranty ?? (jo as any).warranty ?? '';
  const releasedBy = options?.releasedBy ?? (jo as any).releasedBy ?? '';

  // Time In = JO creation time, Time Out = completed/for-payment time
  const formatTime = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '___________';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
  };
  const timeIn = formatTime(jo.createdAt);
  const timeOut = formatTime((jo as any).forPaymentAt || (jo as any).completedAt);

  // Build parts rows — pad to at least 12 rows
  const minRows = 12;
  const rowCount = Math.max(parts.length, minRows);
  let partsRows = '';
  for (let i = 0; i < rowCount; i++) {
    const item = parts[i] as any;
    const desc = item ? (item.description || item.inventoryName || '') : '';
    const suppliedTag = item?.suppliedBy === 'customer' ? ' <i>(Customer Provided)</i>' : '';
    partsRows += `<tr style="height:20px;">
      <td class="c-cell">${item ? (i + 1) : ''}</td>
      <td class="c-cell left">${desc}${suppliedTag}</td>
      <td class="c-cell center">${item ? (item.quantity || 1) : ''}</td>
      <td class="c-cell right">${item ? (item.suppliedBy === 'customer' ? '0.00' : ((Number(item.billingPrice) || 0) * (Number(item.quantity) || 1)).toFixed(2)) : ''}</td>
    </tr>`;
  }

  return `
<div class="jo-print-receipt">
  <style>
    .jo-print-receipt {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #000;
      width: 100%;
      padding: 0;
      background: #fff;
    }
    .jo-print-receipt * { box-sizing: border-box; margin: 0; padding: 0; }

    .r-header { text-align: center; padding: 10px 16px 6px; }
    .r-header h1 { font-size: 16px; font-weight: 900; letter-spacing: 0.5px; }
    .r-header .addr { font-size: 9px; font-style: italic; margin-top: 1px; }
    .r-header .phone { font-size: 9px; margin-top: 1px; }

    .r-title-bar { background: #1a2e4a; color: #fff; display: flex; align-items: center; padding: 4px 16px; }
    .r-title-bar h2 { flex: 1; text-align: center; font-size: 13px; font-weight: 800; letter-spacing: 2px; }
    .r-title-bar .r-no { font-size: 12px; font-weight: 800; }

    .r-info { display: flex; padding: 6px 16px; border-bottom: 1px solid #ccc; }
    .r-info-left { flex: 1; }
    .r-info-right { flex: 1; }
    .r-info p { font-size: 9px; margin: 1px 0; }
    .r-info strong { font-weight: 700; }

    .r-body { display: flex; border-top: 1px solid #000; }
    .r-body-left { flex: 6; border-right: 2px solid #000; }
    .r-body-right { flex: 4; padding: 6px 10px; font-size: 8.5px; }

    .r-parts-header { background: #1a2e4a; color: #fff; text-align: center; padding: 3px; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }

    .r-parts-table { width: 100%; border-collapse: collapse; }
    .r-parts-table th { border: 1px solid #000; padding: 2px 4px; font-size: 8px; font-weight: 800; text-transform: uppercase; background: #f5f5f5; text-align: center; }
    .c-cell { border: 1px solid #bbb; padding: 1px 4px; font-size: 9px; }
    .c-cell.left { text-align: left; }
    .c-cell.center { text-align: center; }
    .c-cell.right { text-align: right; }

    .r-totals { border-top: 2px solid #000; }
    .r-totals table { width: 100%; border-collapse: collapse; }
    .r-totals td { border: 1px solid #000; padding: 2px 6px; font-size: 9px; }
    .r-totals .lbl { font-weight: 800; text-transform: uppercase; width: 50%; }
    .r-totals .amt { text-align: right; width: 50%; }
    .r-remarks { border: 1px solid #000; border-top: none; padding: 4px 6px; min-height: 30px; }
    .r-remarks .lbl { font-weight: 800; text-transform: uppercase; font-size: 9px; }
    .r-services-list { margin-top: 4px; font-size: 9px; font-style: italic; }

    .r-warranty { border: 1px solid #000; padding: 6px; margin-bottom: 6px; line-height: 1.4; }
    .r-warranty .w-title { font-weight: 800; font-size: 9px; text-transform: uppercase; margin-bottom: 2px; }
    .r-sig-block { margin-top: 6px; }
    .r-sig-block p { margin: 1px 0; line-height: 1.3; }
    .r-sig-block .sig-area { border-bottom: 1px solid #000; height: 25px; margin: 2px 0 1px; display: flex; align-items: flex-end; justify-content: center; }
    .r-sig-block .sig-area img { max-height: 22px; }
    .r-sig-label { text-align: center; font-style: italic; font-size: 8px; font-weight: 600; }
    .r-time { margin-top: 8px; font-size: 8.5px; }
    .r-time p { margin: 1px 0; }
    .r-note { font-size: 7px; font-style: italic; text-align: center; margin-top: 4px; }
    .r-customer-name { text-align: center; font-size: 9px; font-weight: 600; margin-top: 2px; }

    @media print {
      .jo-print-receipt { border: none; width: 100%; height: 5.5in; overflow: hidden; }
      @page { margin: 0; size: letter; }
      .r-title-bar, .r-parts-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    }
  </style>

  <div class="r-header">
    <h1>CAR EXPERT AUTO CARE CENTER CORP.</h1>
    <p class="addr">PTT Talavera, Brgy. La Torre, Maharlika Highway, Talavera, Nueva Ecija</p>
    <p class="phone">Contact Number: 09178884958</p>
  </div>

  <div class="r-title-bar">
    <h2>JOB ORDER</h2>
    <span class="r-no">NO.${joNumber}</span>
  </div>

  <div class="r-info">
    <div class="r-info-left">
      <p><strong>Customer's Name:</strong> ${jo.customerName || ''}</p>
      <p><strong>Address:</strong> ${jo.address || ''}</p>
      <p><strong>Mobile Number:</strong> ${jo.contact || ''}</p>
      <p><strong>Mode of Payment:</strong> Cash</p>
    </div>
    <div class="r-info-right">
      <p><strong>Date:</strong> ${joDate}</p>
      <p><strong>Vehicle Model:</strong> ${jo.make || ''} ${jo.model || ''}</p>
      <p><strong>Plate Number:</strong> ${jo.plateNumber || ''}</p>
      <p><strong>Kilometer Reading:</strong> ${jo.odometerReading || '-'}</p>
    </div>
  </div>

  <div class="r-body">
    <div class="r-body-left">
      <div class="r-parts-header">PARTS, TIRES AND SUPPLIES</div>
      <table class="r-parts-table">
        <thead>
          <tr>
            <th style="width:50px;">ITEM CODE</th>
            <th>PARTS DESCRIPTION</th>
            <th style="width:60px;">QUANTITY</th>
            <th style="width:70px;">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${partsRows}</tbody>
      </table>

      <div class="r-totals">
        <table>
          <tr><td class="lbl">TOTAL</td><td class="amt">${partsTotal.toFixed(2)}</td></tr>
          <tr><td class="lbl">LABOR</td><td class="amt">${laborFee.toFixed(2)}</td></tr>
          ${discount ? `<tr><td class="lbl">DISCOUNT</td><td class="amt">-${discount.toFixed(2)}</td></tr>` : ''}
          <tr><td class="lbl">GRAND TOTAL</td><td class="amt" style="font-weight:900;">${grandTotal.toFixed(2)}</td></tr>
        </table>
      </div>

      <div class="r-remarks">
        <span class="lbl">REMARKS</span>
        <p style="font-size:9px;margin-top:2px;">${jo.description || ''}</p>
        ${servicesList ? `<div class="r-services-list"><strong>Services:</strong> ${servicesList}</div>` : ''}
      </div>
    </div>

    <div class="r-body-right">
      <div class="r-warranty">
        <p class="w-title">WARRANTY</p>
        <p>${warranty || ''}</p>
        <p style="margin-top:4px;"><strong>PARTS SUPPLIED BY:</strong></p>
        <p>${partsSuppliedBy === 'car_expert' ? '(X)' : '( )'} CAR EXPERT</p>
        <p>${partsSuppliedBy === 'customer' ? '(X)' : '( )'} CUSTOMER</p>
      </div>

      <div class="r-sig-block">
        <p>I authorized and agree to pay for repair and work to be done on my vehicle including all parts and materials necessary to perform them.</p>
        <p class="r-sig-label">Customer's Signature</p>
        <div class="sig-area">
          ${jo.customerSignatureData ? `<img src="${jo.customerSignatureData}" />` : ''}
        </div>
      </div>

      <div class="r-time">
        <p><strong>TIME IN:</strong> ${timeIn}&nbsp;&nbsp;&nbsp;<strong>TIME OUT:</strong> ${timeOut}</p>
        <p><strong>RELEASED BY:</strong> ${releasedBy || '___________'}</p>
      </div>

      <p class="r-note">NOTE: This job is based on our inspection but does not include defects not evident at the time of our inspection.</p>

      <div class="r-sig-block">
        <p class="r-sig-label">Mechanic Signature</p>
        <div class="sig-area"></div>
      </div>

      <div class="r-sig-block" style="margin-top:6px;">
        <p>I hereby received above vehicle in good order and condition. I hereby certify that the repairs have been made to my entire satisfaction.</p>
        <p class="r-sig-label">Customer's Signature</p>
        <div class="sig-area"></div>
        <p class="r-customer-name">${jo.customerName || ''}</p>
      </div>
    </div>
  </div>
</div>`;
}
