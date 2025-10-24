// Order Service - Domain Model Implementation
// This demonstrates a rich domain model with DDD principles

const { generateId } = require('../../../shared/utils');
const { DomainError } = require('../../../shared/errors');
const { OrderCreated, OrderConfirmed, OrderShipped, OrderCancelled } = require('../../../shared/domain-events');

// Value Objects
class Money {
  constructor(amount, currency) {
    if (amount < 0) {
      throw new DomainError('Amount cannot be negative');
    }
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  static zero(currency = 'USD') {
    return new Money(0, currency);
  }

  add(other) {
    if (this.currency !== other.currency) {
      throw new DomainError('Cannot add different currencies');
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  multiply(factor) {
    return new Money(this.amount * factor, this.currency);
  }

  equals(other) {
    return this.amount === other.amount && this.currency === other.currency;
  }

  toString() {
    return `${this.amount} ${this.currency}`;
  }
}

class Address {
  constructor(street, city, state, zipCode, country = 'USA') {
    if (!street || !city || !state || !zipCode) {
      throw new DomainError('Address requires street, city, state, and zipCode');
    }
    
    this.street = street;
    this.city = city;
    this.state = state;
    this.zipCode = zipCode;
    this.country = country;
    Object.freeze(this);
  }

  equals(other) {
    return this.street === other.street &&
           this.city === other.city &&
           this.state === other.state &&
           this.zipCode === other.zipCode &&
           this.country === other.country;
  }

  toString() {
    return `${this.street}, ${this.city}, ${this.state} ${this.zipCode}, ${this.country}`;
  }
}

// Enums
const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED'
};

// Entities
class OrderLineItem {
  constructor(productId, quantity, unitPrice, productName = null) {
    if (quantity <= 0) {
      throw new DomainError('Quantity must be positive');
    }
    if (unitPrice < 0) {
      throw new DomainError('Unit price cannot be negative');
    }

    this.lineItemId = generateId();
    this.productId = productId;
    this.quantity = quantity;
    this.unitPrice = new Money(unitPrice, 'USD');
    this.productName = productName;
  }

  getSubtotal() {
    return this.unitPrice.multiply(this.quantity);
  }

  changeQuantity(newQuantity) {
    if (newQuantity <= 0) {
      throw new DomainError('Quantity must be positive');
    }
    this.quantity = newQuantity;
  }
}

// Aggregate Root
class Order {
  constructor(orderId, customerId) {
    this.orderId = orderId;
    this.customerId = customerId;
    this.status = OrderStatus.PENDING;
    this.orderDate = new Date();
    this.lineItems = [];
    this.shippingAddress = null;
    this.billingAddress = null;
    this.totalAmount = Money.zero('USD');
    this.trackingNumber = null;
    this.version = 0;
    
    // Domain Events
    this.domainEvents = [];
  }

  // Factory method
  static create(customerId, lineItemsData, shippingAddress, billingAddress = null) {
    const order = new Order(generateId(), customerId);

    // Add line items
    lineItemsData.forEach(itemData => {
      order.addLineItem(
        itemData.productId,
        itemData.quantity,
        itemData.unitPrice,
        itemData.productName
      );
    });

    // Set addresses
    order.setShippingAddress(shippingAddress);
    if (billingAddress) {
      order.setBillingAddress(billingAddress);
    } else {
      order.setBillingAddress(shippingAddress); // Use shipping as billing
    }

    // Raise domain event
    order.addDomainEvent(new OrderCreated({
      orderId: order.orderId,
      customerId: order.customerId,
      lineItems: order.lineItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.amount,
        productName: item.productName
      })),
      totalAmount: order.totalAmount.amount,
      shippingAddress: order.shippingAddress
    }));

    return order;
  }

  // Business Methods
  addLineItem(productId, quantity, unitPrice, productName = null) {
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Cannot modify order that is not pending');
    }

    const lineItem = new OrderLineItem(productId, quantity, unitPrice, productName);
    this.lineItems.push(lineItem);
    this.recalculateTotal();
  }

  removeLineItem(lineItemId) {
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Cannot modify order that is not pending');
    }

    const index = this.lineItems.findIndex(item => item.lineItemId === lineItemId);
    if (index === -1) {
      throw new DomainError('Line item not found');
    }

    this.lineItems.splice(index, 1);
    this.recalculateTotal();
  }

  updateLineItemQuantity(lineItemId, newQuantity) {
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Cannot modify order that is not pending');
    }

    const lineItem = this.lineItems.find(item => item.lineItemId === lineItemId);
    if (!lineItem) {
      throw new DomainError('Line item not found');
    }

    lineItem.changeQuantity(newQuantity);
    this.recalculateTotal();
  }

  setShippingAddress(address) {
    if (!(address instanceof Address)) {
      throw new DomainError('Invalid shipping address');
    }
    this.shippingAddress = address;
  }

  setBillingAddress(address) {
    if (!(address instanceof Address)) {
      throw new DomainError('Invalid billing address');
    }
    this.billingAddress = address;
  }

  confirm() {
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Only pending orders can be confirmed');
    }

    if (this.lineItems.length === 0) {
      throw new DomainError('Cannot confirm order with no items');
    }

    if (!this.shippingAddress) {
      throw new DomainError('Shipping address is required');
    }

    this.status = OrderStatus.CONFIRMED;
    this.version++;

    this.addDomainEvent(new OrderConfirmed({
      orderId: this.orderId,
      customerId: this.customerId,
      totalAmount: this.totalAmount.amount,
      lineItems: this.lineItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    }));
  }

  ship(trackingNumber) {
    if (this.status !== OrderStatus.CONFIRMED) {
      throw new DomainError('Only confirmed orders can be shipped');
    }

    if (!trackingNumber) {
      throw new DomainError('Tracking number is required');
    }

    this.status = OrderStatus.SHIPPED;
    this.trackingNumber = trackingNumber;
    this.version++;

    this.addDomainEvent(new OrderShipped({
      orderId: this.orderId,
      customerId: this.customerId,
      trackingNumber: this.trackingNumber,
      shippingAddress: this.shippingAddress
    }));
  }

  deliver() {
    if (this.status !== OrderStatus.SHIPPED) {
      throw new DomainError('Only shipped orders can be delivered');
    }

    this.status = OrderStatus.DELIVERED;
    this.version++;
  }

  cancel(reason = null) {
    if (this.status === OrderStatus.DELIVERED) {
      throw new DomainError('Cannot cancel delivered order');
    }

    if (this.status === OrderStatus.CANCELLED) {
      throw new DomainError('Order is already cancelled');
    }

    const previousStatus = this.status;
    this.status = OrderStatus.CANCELLED;
    this.version++;

    this.addDomainEvent(new OrderCancelled({
      orderId: this.orderId,
      customerId: this.customerId,
      previousStatus: previousStatus,
      reason: reason,
      lineItems: this.lineItems.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    }));
  }

  // Helper Methods
  recalculateTotal() {
    this.totalAmount = this.lineItems.reduce(
      (total, item) => total.add(item.getSubtotal()),
      Money.zero('USD')
    );
  }

  getLineItemCount() {
    return this.lineItems.reduce((total, item) => total + item.quantity, 0);
  }

  hasProduct(productId) {
    return this.lineItems.some(item => item.productId === productId);
  }

  // Domain Events Management
  addDomainEvent(event) {
    this.domainEvents.push(event);
  }

  getDomainEvents() {
    return [...this.domainEvents];
  }

  clearDomainEvents() {
    this.domainEvents = [];
  }

  // Serialization for persistence
  toJSON() {
    return {
      orderId: this.orderId,
      customerId: this.customerId,
      status: this.status,
      orderDate: this.orderDate,
      lineItems: this.lineItems.map(item => ({
        lineItemId: item.lineItemId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.amount,
        productName: item.productName
      })),
      shippingAddress: this.shippingAddress ? {
        street: this.shippingAddress.street,
        city: this.shippingAddress.city,
        state: this.shippingAddress.state,
        zipCode: this.shippingAddress.zipCode,
        country: this.shippingAddress.country
      } : null,
      billingAddress: this.billingAddress ? {
        street: this.billingAddress.street,
        city: this.billingAddress.city,
        state: this.billingAddress.state,
        zipCode: this.billingAddress.zipCode,
        country: this.billingAddress.country
      } : null,
      totalAmount: this.totalAmount.amount,
      trackingNumber: this.trackingNumber,
      version: this.version
    };
  }

  // Reconstruction from persistence
  static fromJSON(data) {
    const order = new Order(data.orderId, data.customerId);
    
    order.status = data.status;
    order.orderDate = new Date(data.orderDate);
    order.trackingNumber = data.trackingNumber;
    order.version = data.version;

    // Reconstruct line items
    order.lineItems = data.lineItems.map(itemData => 
      new OrderLineItem(
        itemData.productId,
        itemData.quantity,
        itemData.unitPrice,
        itemData.productName
      )
    );

    // Reconstruct addresses
    if (data.shippingAddress) {
      order.shippingAddress = new Address(
        data.shippingAddress.street,
        data.shippingAddress.city,
        data.shippingAddress.state,
        data.shippingAddress.zipCode,
        data.shippingAddress.country
      );
    }

    if (data.billingAddress) {
      order.billingAddress = new Address(
        data.billingAddress.street,
        data.billingAddress.city,
        data.billingAddress.state,
        data.billingAddress.zipCode,
        data.billingAddress.country
      );
    }

    // Recalculate total
    order.recalculateTotal();

    return order;
  }
}

module.exports = {
  Order,
  OrderLineItem,
  Money,
  Address,
  OrderStatus
};