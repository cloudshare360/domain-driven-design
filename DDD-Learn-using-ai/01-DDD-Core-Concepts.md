# 🔹 Phase 1: DDD Core Concepts (Strategic + Tactical Design)

## Overview
Domain-Driven Design (DDD) is a software development philosophy that emphasizes collaboration between technical and domain experts to create a model that accurately reflects the business domain. This guide covers both strategic and tactical DDD patterns.

> 💡 **Key Insight**: DDD is **not about technology**—it's about **modeling complex business logic** clearly.

---

## 📋 Table of Contents
1. [Strategic Design](#strategic-design)
2. [Tactical Design](#tactical-design) 
3. [DDD Building Blocks Quick Reference](#quick-reference)
4. [Implementation Examples](#implementation-examples)
5. [Common Misconceptions](#common-misconceptions)

---

## 🎯 Strategic Design

Strategic Design focuses on the high-level architecture and organization of the domain model. It's about understanding the business and creating boundaries.

### 1.1 Ubiquitous Language

**Definition**: A shared language between developers and domain experts that is reflected in the code.

**Key Points**:
- Same terminology used in conversations, documentation, and code
- Reduces translation errors between business and technical teams
- Evolves with understanding of the domain

**Example**:
```javascript
// ❌ Generic technical terms
class DataProcessor {
  process(data) { ... }
}

// ✅ Ubiquitous Language
class OrderProcessor {
  fulfillOrder(order) { ... }
  cancelOrder(orderId) { ... }
}
```

**Best Practices**:
- Hold regular domain modeling sessions
- Create a glossary of domain terms
- Update code when language evolves
- Avoid technical jargon in domain discussions

### 1.2 Bounded Context

**Definition**: A logical boundary where a particular domain model applies and is consistent.

**Key Points**:
- Each bounded context has its own model
- Same entity can have different representations in different contexts
- Provides clear ownership boundaries
- Maps well to team boundaries

**Example**:
```
Sales Context:        │  Shipping Context:
Customer {            │  Customer {
  customerId          │    customerId
  creditLimit         │    shippingAddress
  salesHistory        │    deliveryPreferences
}                     │  }
```

**Identifying Bounded Contexts**:
1. Look for different business rules for the same concept
2. Identify team boundaries
3. Find areas with different data needs
4. Notice language variations

### 1.3 Context Mapping

**Definition**: How bounded contexts interact and relate to each other.

**Common Patterns**:

#### Customer-Supplier
One context serves another; supplier has some influence over consumer needs.

#### Conformist
Downstream context accepts upstream's model without modification.

#### Anti-Corruption Layer (ACL)
Protects downstream context from upstream changes via translation layer.

#### Shared Kernel
Small shared model between contexts (use sparingly).

#### Partnership
Two contexts evolve together; requires close coordination.

**Example Context Map**:
```
[Order Context] --Customer/Supplier--> [Payment Context]
[Order Context] --ACL--> [Legacy Inventory System]
[Product Catalog] <--Shared Kernel--> [Pricing Context]
```

---

## ⚙️ Tactical Design

Tactical Design provides the building blocks for implementing the domain model within a bounded context.

### 2.1 Entity

**Definition**: An object with a unique identity that persists over time.

**Characteristics**:
- Has unique identifier
- Identity remains constant even if attributes change
- Mutable
- Lifecycle is important

**Example**:
```javascript
class Order {
  constructor(orderId, customerId) {
    this.orderId = orderId;      // Identity
    this.customerId = customerId;
    this.status = 'PENDING';
    this.lineItems = [];
    this.createdAt = new Date();
  }

  addLineItem(product, quantity, price) {
    // Business logic here
    this.lineItems.push(new OrderLineItem(product, quantity, price));
  }

  markAsShipped() {
    if (this.status !== 'CONFIRMED') {
      throw new Error('Only confirmed orders can be shipped');
    }
    this.status = 'SHIPPED';
  }
}
```

### 2.2 Value Object

**Definition**: An object that represents a concept with no identity; defined by its attributes.

**Characteristics**:
- Immutable
- No identity
- Equality based on attributes
- Can be shared safely

**Example**:
```javascript
class Money {
  constructor(amount, currency) {
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this); // Immutable
  }

  add(other) {
    if (this.currency !== other.currency) {
      throw new Error('Cannot add different currencies');
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  equals(other) {
    return this.amount === other.amount && 
           this.currency === other.currency;
  }
}

class Address {
  constructor(street, city, zipCode, country) {
    this.street = street;
    this.city = city;
    this.zipCode = zipCode;
    this.country = country;
    Object.freeze(this);
  }
}
```

### 2.3 Aggregate

**Definition**: A cluster of domain objects treated as a single unit for data changes.

**Key Rules**:
- Has one Aggregate Root (the only entry point)
- Root enforces invariants
- External objects can only reference the root
- One aggregate per transaction

**Example**:
```javascript
// Aggregate Root
class Order {
  constructor(orderId, customerId) {
    this.orderId = orderId;
    this.customerId = customerId;
    this.lineItems = [];
    this.status = 'PENDING';
  }

  // Only way to add line items (maintains invariants)
  addLineItem(productId, quantity, unitPrice) {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive');
    }
    
    const lineItem = new OrderLineItem(productId, quantity, unitPrice);
    this.lineItems.push(lineItem);
    
    // Business rule: Orders over $1000 need approval
    if (this.getTotalAmount() > 1000) {
      this.status = 'NEEDS_APPROVAL';
    }
  }

  getTotalAmount() {
    return this.lineItems.reduce((total, item) => 
      total + (item.quantity * item.unitPrice), 0);
  }
}

// Internal entity (not aggregate root)
class OrderLineItem {
  constructor(productId, quantity, unitPrice) {
    this.productId = productId;
    this.quantity = quantity;
    this.unitPrice = unitPrice;
  }
}
```

### 2.4 Repository

**Definition**: Encapsulates the logic to access domain objects, providing a collection-like interface.

**Purpose**:
- Abstract persistence mechanism
- Provide query interface for aggregates
- Maintain aggregate boundaries

**Example**:
```javascript
// Interface/Contract
class OrderRepository {
  async save(order) {
    throw new Error('Not implemented');
  }

  async findById(orderId) {
    throw new Error('Not implemented');
  }

  async findByCustomerId(customerId) {
    throw new Error('Not implemented');
  }
}

// Implementation
class PostgresOrderRepository extends OrderRepository {
  constructor(dbConnection) {
    super();
    this.db = dbConnection;
  }

  async save(order) {
    // Convert aggregate to database format
    const orderData = {
      id: order.orderId,
      customer_id: order.customerId,
      status: order.status,
      line_items: order.lineItems.map(item => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice
      }))
    };

    await this.db.transaction(async (trx) => {
      await trx('orders').insert(orderData);
      await trx('order_line_items').insert(orderData.line_items);
    });
  }

  async findById(orderId) {
    const orderData = await this.db('orders')
      .where({ id: orderId })
      .first();
    
    if (!orderData) return null;

    const lineItems = await this.db('order_line_items')
      .where({ order_id: orderId });

    // Reconstruct aggregate
    return this.toDomainObject(orderData, lineItems);
  }
}
```

### 2.5 Domain Service

**Definition**: Stateless service that contains domain logic that doesn't naturally fit within an entity or value object.

**When to Use**:
- Logic involves multiple aggregates
- Complex calculations or algorithms
- Integration with external domain concepts

**Example**:
```javascript
class PricingService {
  constructor(discountRepository, taxService) {
    this.discountRepository = discountRepository;
    this.taxService = taxService;
  }

  async calculateOrderPrice(order, customer) {
    let subtotal = order.getSubtotal();
    
    // Apply customer-specific discounts
    const discount = await this.discountRepository
      .findApplicableDiscount(customer, order);
    
    if (discount) {
      subtotal = discount.apply(subtotal);
    }

    // Calculate tax
    const tax = await this.taxService
      .calculateTax(subtotal, customer.address);

    return {
      subtotal,
      discount: discount?.amount || 0,
      tax,
      total: subtotal + tax
    };
  }
}
```

### 2.6 Application Service

**Definition**: Orchestrates domain objects to fulfill use cases; acts as a facade to the domain layer.

**Responsibilities**:
- Coordinate use cases
- Manage transactions
- Handle security
- Convert between DTOs and domain objects

**Example**:
```javascript
class OrderApplicationService {
  constructor(orderRepo, inventoryService, eventPublisher) {
    this.orderRepo = orderRepo;
    this.inventoryService = inventoryService;
    this.eventPublisher = eventPublisher;
  }

  async placeOrder(placeOrderCommand) {
    // Convert DTO to domain objects
    const { customerId, lineItems } = placeOrderCommand;
    
    // Check inventory availability
    for (const item of lineItems) {
      const available = await this.inventoryService
        .isAvailable(item.productId, item.quantity);
      
      if (!available) {
        throw new Error(`Insufficient stock for ${item.productId}`);
      }
    }

    // Create and configure aggregate
    const order = new Order(
      this.generateOrderId(), 
      customerId
    );

    lineItems.forEach(item => {
      order.addLineItem(
        item.productId, 
        item.quantity, 
        item.unitPrice
      );
    });

    // Persist
    await this.orderRepo.save(order);

    // Publish domain event
    await this.eventPublisher.publish(
      new OrderPlaced(order.orderId, order.customerId, order.lineItems)
    );

    return {
      orderId: order.orderId,
      status: order.status,
      totalAmount: order.getTotalAmount()
    };
  }
}
```

### 2.7 Domain Events

**Definition**: Something that happened in the domain that domain experts care about.

**Characteristics**:
- Immutable
- Named in past tense
- Contains minimal necessary data
- Triggers side effects

**Example**:
```javascript
class DomainEvent {
  constructor() {
    this.occurredAt = new Date();
    this.eventId = this.generateId();
  }
}

class OrderPlaced extends DomainEvent {
  constructor(orderId, customerId, lineItems) {
    super();
    this.orderId = orderId;
    this.customerId = customerId;
    this.lineItems = lineItems;
  }
}

class OrderShipped extends DomainEvent {
  constructor(orderId, trackingNumber, shippingAddress) {
    super();
    this.orderId = orderId;
    this.trackingNumber = trackingNumber;
    this.shippingAddress = shippingAddress;
  }
}

// Event handling
class OrderEventHandler {
  constructor(emailService, inventoryService) {
    this.emailService = emailService;
    this.inventoryService = inventoryService;
  }

  async handle(event) {
    switch (event.constructor.name) {
      case 'OrderPlaced':
        await this.inventoryService.reserveStock(event.lineItems);
        await this.emailService.sendOrderConfirmation(event.customerId);
        break;
      
      case 'OrderShipped':
        await this.emailService.sendShippingNotification(
          event.customerId, 
          event.trackingNumber
        );
        break;
    }
  }
}
```

---

## 📚 Quick Reference

### Strategic Patterns
| Pattern | Purpose | When to Use |
|---------|---------|-------------|
| Ubiquitous Language | Shared vocabulary | Always in DDD |
| Bounded Context | Model boundaries | When contexts differ |
| Context Map | Inter-context relationships | Multiple contexts |

### Tactical Patterns
| Pattern | Identity | Mutability | Purpose |
|---------|----------|------------|---------|
| Entity | Yes | Mutable | Things with lifecycle |
| Value Object | No | Immutable | Descriptive concepts |
| Aggregate | Root only | Mutable | Consistency boundary |
| Repository | N/A | N/A | Data access abstraction |
| Domain Service | N/A | Stateless | Cross-aggregate logic |
| Application Service | N/A | Stateless | Use case orchestration |

---

## 🚫 Common Misconceptions

### ❌ "DDD is about Clean Architecture"
DDD is about modeling the domain. Architecture patterns like Clean/Hexagonal can support DDD but aren't DDD itself.

### ❌ "Every class should be an Entity or Value Object"
Not all objects are domain objects. DTOs, infrastructure services, and UI models serve different purposes.

### ❌ "Aggregates should be large"
Aggregates should be as small as possible while maintaining consistency. Large aggregates hurt performance and concurrency.

### ❌ "One Entity per Database Table"
Entities represent domain concepts, not database structure. One aggregate might span multiple tables.

### ❌ "DDD requires Event Sourcing/CQRS"
These patterns can complement DDD but aren't required. Start simple with traditional persistence.

---

## ✅ Next Steps
After mastering these concepts, move to **Phase 2: Problem-to-Solution Mapping** to learn how to apply DDD to real business problems.